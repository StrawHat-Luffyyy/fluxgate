"""FluxGate AI anomaly consumer (entry point: `python consumer.py`).

Consumes gateway traffic telemetry from Kafka, scores it with an Isolation Forest, explains
anomalies with SHAP and POSTs signed alerts to the gateway.

Delivery semantics: at-least-once. Auto-commit is off and the offset is committed synchronously
after each message is fully handled:
  * scored/skipped/alerted         -> commit
  * malformed or permanently rejected -> copy to the DLQ topic, then commit
  * alert delivery retries exhausted or DLQ write failed -> do NOT commit, seek back so the same
    message is reprocessed (the gateway deduplicates on tenantId+requestId).
"""

from __future__ import annotations

import json
import logging
import signal
import sys
import threading
import time
from enum import Enum
from typing import Any, Optional

from alerts import AlertClient, PermanentAlertError, TransientAlertError, build_payload
from health import HealthState, start_health_server
from jsonlog import configure_logging
from model_store import ModelStoreError, load_model
from scoring import InvalidMessage, Scorer, parse_event
from settings import Settings, SettingsError
from tracing import extract_trace_context

logger = logging.getLogger("fluxgate.consumer")

RETRY_PAUSE_SECONDS = 5.0


class Outcome(Enum):
    COMMIT = "commit"
    RETRY = "retry"  # do not commit; seek back and reprocess


class DeadLetterQueue:
    """Copies the original bytes plus error headers to a real Kafka DLQ topic."""

    def __init__(self, producer: Any, topic: str, flush_timeout: float = 10.0):
        self.producer = producer
        self.topic = topic
        self.flush_timeout = flush_timeout

    def send(self, msg: Any, reason: str) -> bool:
        """True only when the broker acknowledged the DLQ record."""
        errors: list = []

        def on_delivery(err, _m):
            if err is not None:
                errors.append(err)

        headers = [(k, v) for k, v in (msg.headers() or []) if isinstance(k, str) and isinstance(v, (bytes, str))]
        headers += [
            ("x-dlq-error", reason[:500].encode("utf-8", "replace")),
            ("x-dlq-source", f"{msg.topic()}[{msg.partition()}]@{msg.offset()}".encode()),
        ]
        try:
            self.producer.produce(
                self.topic, value=msg.value(), key=msg.key(), headers=headers, on_delivery=on_delivery
            )
            remaining = self.producer.flush(self.flush_timeout)
        except Exception:
            logger.exception("DLQ produce failed")
            return False
        return remaining == 0 and not errors


class Processor:
    """Decides what to do with one Kafka message. Kafka-free apart from the msg accessors."""

    def __init__(self, scorer: Scorer, alerts: AlertClient, dlq: DeadLetterQueue, health: HealthState):
        self.scorer = scorer
        self.alerts = alerts
        self.dlq = dlq
        self.health = health

    def _dead_letter(self, msg: Any, reason: str, log_extra: dict) -> Outcome:
        if self.dlq.send(msg, reason):
            self.health.incr(dlq=1)
            logger.error("message sent to DLQ: %s", reason, extra=log_extra)
            return Outcome.COMMIT
        logger.error("DLQ write failed, message will be reprocessed", extra=log_extra)
        return Outcome.RETRY

    def handle(self, msg: Any) -> Outcome:
        trace = extract_trace_context(msg.headers())
        extra: dict = {"traceId": trace.trace_id, "offset": msg.offset(), "partition": msg.partition()}
        self.health.message_seen()
        try:
            return self._handle(msg, trace, extra)
        except Exception as exc:  # never crash on a bad message
            logger.exception("unexpected error handling message", extra=extra)
            return self._dead_letter(msg, f"unexpected error: {type(exc).__name__}: {exc}", extra)

    def _handle(self, msg: Any, trace, extra: dict) -> Outcome:
        raw = msg.value()
        try:
            if raw is None:
                raise InvalidMessage("empty message value")
            event = parse_event(json.loads(raw.decode("utf-8")))
        except (UnicodeDecodeError, json.JSONDecodeError, InvalidMessage) as exc:
            return self._dead_letter(msg, f"invalid message: {exc}", extra)

        extra.update(requestId=event.request_id, tenantId=event.tenant_id)

        if event.rate_limited:
            logger.debug("rate-limited request skipped", extra=extra)
            self.health.incr(processed=1)
            return Outcome.COMMIT

        assert event.features is not None
        result = self.scorer.score(event.features)
        if not result.is_anomaly:
            logger.info("traffic normal", extra={**extra, "score": round(result.score, 4)})
            self.health.incr(processed=1)
            return Outcome.COMMIT

        logger.warning(
            "anomaly detected",
            extra={**extra, "score": round(result.score, 4), "topFeature": result.top_feature,
                   "topFeatureValue": result.top_feature_value, "attribution": result.attribution},
        )
        payload = build_payload(event, result, self.scorer.version)
        try:
            self.alerts.send(payload, event.request_id, trace)
        except PermanentAlertError as exc:
            self.health.incr(alert_failures=1)
            return self._dead_letter(msg, f"alert rejected: {exc}", extra)
        except TransientAlertError as exc:
            self.health.incr(alert_failures=1)
            self.health.update(alerts_failing=True)
            logger.error("alert delivery exhausted, will reprocess: %s", exc, extra=extra)
            return Outcome.RETRY

        self.health.update(alerts_failing=False)
        self.health.incr(processed=1, anomalies=1)
        return Outcome.COMMIT


def run_loop(consumer: Any, processor: Processor, health: HealthState, stop: threading.Event, kafka_error_cls: Any) -> int:
    """Poll/process/commit loop. Returns a process exit code."""
    from confluent_kafka import KafkaException, TopicPartition  # local: keeps module importable w/o Kafka in tests

    last_error_at = float("-inf")
    health.update(started=True)
    while not stop.is_set():
        msg = consumer.poll(1.0)
        if msg is None:
            # A timeout without an error event means the client is not reporting trouble.
            if time.monotonic() - last_error_at > 30:
                health.update(kafka_connected=True)
            continue

        err = msg.error()
        if err:
            if err.code() == kafka_error_cls._PARTITION_EOF:
                continue
            if err.fatal():
                logger.critical("fatal Kafka error: %s", err)
                health.update(fatal=True, kafka_connected=False)
                return 1
            # Retriable (e.g. brokers down): librdkafka reconnects on its own.
            logger.error("Kafka error (will keep polling): %s", err)
            last_error_at = time.monotonic()
            health.update(kafka_connected=False)
            continue

        health.update(kafka_connected=True)
        outcome = processor.handle(msg)

        if outcome is Outcome.COMMIT:
            try:
                consumer.commit(message=msg, asynchronous=False)
            except KafkaException as exc:
                logger.error("offset commit failed: %s", exc)
                if exc.args and hasattr(exc.args[0], "fatal") and exc.args[0].fatal():
                    health.update(fatal=True)
                    return 1
        else:
            try:
                consumer.seek(TopicPartition(msg.topic(), msg.partition(), msg.offset()))
            except KafkaException as exc:
                logger.error("seek failed: %s", exc)
            stop.wait(RETRY_PAUSE_SECONDS)
    return 0


def install_signal_handlers(stop: threading.Event) -> None:
    def handler(signum, _frame):
        logger.info("shutdown signal received", extra={"signal": signum})
        stop.set()

    # SIGTERM exists on Windows but is only delivered via os.kill; SIGBREAK is Ctrl+Break there.
    for name in ("SIGINT", "SIGTERM", "SIGBREAK"):
        sig = getattr(signal, name, None)
        if sig is None:
            continue
        try:
            signal.signal(sig, handler)
        except (ValueError, OSError):  # not main thread / unsupported on this platform
            logger.debug("could not install handler for %s", name)


def main() -> int:
    try:
        settings = Settings.from_env()
    except SettingsError as exc:
        print(f"configuration error: {exc}", file=sys.stderr)
        return 2
    configure_logging(settings.log_level)

    try:
        loaded = load_model(settings.model_dir, settings.model_version)
    except ModelStoreError as exc:
        logger.critical("cannot load model: %s", exc)
        return 2

    from confluent_kafka import Consumer, KafkaError, Producer

    scorer = Scorer(loaded.model, loaded.baseline, loaded.version, loaded.metadata.get("featureMax"))
    health = HealthState(model_version=loaded.version)
    start_health_server(health, settings.health_port)

    consumer = Consumer({
        "bootstrap.servers": settings.kafka_brokers,
        "group.id": settings.kafka_group_id,
        "auto.offset.reset": "earliest",
        "enable.auto.commit": False,
        "enable.partition.eof": False,
    })
    producer = Producer({"bootstrap.servers": settings.kafka_brokers, "enable.idempotence": True})
    alerts = AlertClient(settings.alert_endpoint, settings.internal_alert_secret)
    stop = threading.Event()
    alerts.sleep = stop.wait  # backoff sleeps wake up on shutdown
    processor = Processor(scorer, alerts, DeadLetterQueue(producer, settings.kafka_dlq_topic), health)
    install_signal_handlers(stop)

    consumer.subscribe([settings.kafka_topic])
    logger.info("consumer started", extra={"topic": settings.kafka_topic, "group": settings.kafka_group_id,
                                           "modelVersion": loaded.version})
    code = 1
    try:
        code = run_loop(consumer, processor, health, stop, KafkaError)
    finally:
        logger.info("shutting down")
        health.update(started=False)
        consumer.close()
        producer.flush(10)
        logger.info("consumer closed")
    return code


if __name__ == "__main__":
    sys.exit(main())
