"""
FluxGate AI Anomaly Detection Consumer

Consumes traffic logs from Kafka, runs Isolation Forest inference,
explains anomalies with SHAP, and fires alerts to the gateway.

OpenTelemetry trace context is extracted from Kafka headers and propagated
into child spans — preserving distributed tracing from Node.js → Python.
"""

import sys
import json
import time
import logging
import pickle
from typing import Optional

import numpy as np
import numpy.typing as npt
import shap
import requests

from sklearn.ensemble import IsolationForest

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

from confluent_kafka import Consumer, KafkaError  
from opentelemetry import propagate, trace  
from opentelemetry.sdk.trace import TracerProvider  
from opentelemetry.sdk.trace.export import (  
    SimpleSpanProcessor,
    ConsoleSpanExporter,
)

# --- Structured Logging ---
logging.basicConfig(
    level=logging.INFO,
    format='{"timestamp":"%(asctime)s","level":"%(levelname)s","module":"%(name)s","message":"%(message)s"}',
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("fluxgate-ai-consumer")

# --- OpenTelemetry Tracer ---
provider = TracerProvider()
processor = SimpleSpanProcessor(ConsoleSpanExporter())
provider.add_span_processor(processor)
trace.set_tracer_provider(provider)
tracer = trace.get_tracer("fluxgate-ai-consumer")

# --- Constants ---
KAFKA_BROKER = "localhost:19092"
KAFKA_TOPIC = "gateway.traffic.logs"
KAFKA_GROUP = "fluxgate-ai-workers"
ALERT_ENDPOINT = "http://localhost:3000/internal/alerts"
MAX_CONNECT_RETRIES = 10
FEATURE_NAMES: list[str] = ["requestByteSize", "responseByteSize", "latencyMs"]


def load_model_and_baseline() -> tuple[IsolationForest, npt.NDArray[np.float64]]:
    """Loads the trained Isolation Forest model and SHAP baseline data from disk."""
    with open("model.pkl", "rb") as f:
        model: IsolationForest = pickle.load(f)
    try:
        with open("baseline_data.pkl", "rb") as f:
            X_train: npt.NDArray[np.float64] = pickle.load(f)
    except FileNotFoundError:
        logger.warning("baseline_data.pkl not found, using random fallback for SHAP")
        X_train = np.random.normal(100, 10, (100, 3))
    return model, X_train


def create_consumer_with_backoff() -> Consumer:
    """Creates a Kafka consumer with exponential backoff on connection failures."""
    conf = {
        "bootstrap.servers": KAFKA_BROKER,
        "group.id": KAFKA_GROUP,
        "auto.offset.reset": "earliest",
    }

    for attempt in range(MAX_CONNECT_RETRIES):
        try:
            consumer = Consumer(conf)
            consumer.subscribe([KAFKA_TOPIC])
            logger.info("Kafka Consumer connected and subscribed to %s", KAFKA_TOPIC)
            return consumer
        except Exception as e:
            wait_seconds = min(2 ** attempt, 60)
            logger.warning(
                "Kafka connection failed (attempt %d/%d): %s. Retrying in %ds...",
                attempt + 1,
                MAX_CONNECT_RETRIES,
                str(e),
                wait_seconds,
            )
            time.sleep(wait_seconds)

    logger.critical("Failed to connect to Kafka after %d attempts. Exiting.", MAX_CONNECT_RETRIES)
    sys.exit(1)


def send_alert(tenant_id: Optional[str], message: str, data: dict) -> None:
    """Sends an anomaly alert to the gateway internal endpoint."""
    try:
        requests.post(
            ALERT_ENDPOINT,
            json={
                "tenantId": tenant_id,
                "alertType": "anomaly_detected",
                "message": message,
                "data": data,
            },
            timeout=5,
        )
    except requests.RequestException as e:
        logger.error("Failed to send alert for tenant %s: %s", tenant_id, str(e))


def start_consumer() -> None:
    """Main consumer loop: load model, poll Kafka, run inference, fire alerts."""
    model, X_train = load_model_and_baseline()

    logger.info("Initializing SHAP Explainer...")
    explainer = shap.TreeExplainer(model, data=X_train)
    logger.info("AI Model and SHAP Explainer loaded. Starting Kafka Consumer...")

    consumer = create_consumer_with_backoff()

    try:
        while True:
            msg = consumer.poll(1.0)

            if msg is None:
                continue

            if msg.error():
                if msg.error().code() == KafkaError._PARTITION_EOF:
                    continue
                else:
                    logger.error("Kafka Error: %s", msg.error())
                    break

            # Deserialize tracing context from headers
            headers_dict: dict[str, str] = {}
            kafka_headers = msg.headers()
            if kafka_headers:
                for k, v in kafka_headers:
                    val = v.decode("utf-8") if isinstance(v, bytes) else v
                    headers_dict[k] = val

            parent_context = propagate.extract(headers_dict)

            # Start Python child span linked to Node.js Gateway span
            with tracer.start_as_current_span("kafka.consume", context=parent_context) as span:
                raw_data: str = msg.value().decode("utf-8")
                features: dict = json.loads(raw_data)

                req_size: int = features.get("requestByteSize", features.get("requestByteBySize", 0))
                res_size: int = features.get("responseByteSize", features.get("responseByteBySize", 0))
                latency: int = features.get("latencyMs", 0)
                tenant_id: Optional[str] = features.get("tenantId")

                span.set_attribute("tenant.id", tenant_id or "")
                span.set_attribute("request.size", req_size)
                span.set_attribute("response.size", res_size)
                span.set_attribute("latency.ms", latency)

                X_test: npt.NDArray[np.float64] = np.array([[req_size, res_size, latency]])
                score: float = model.decision_function(X_test)[0]
                prediction: int = model.predict(X_test)[0]

                if prediction == -1:
                    shap_values = explainer.shap_values(X_test)

                    if isinstance(shap_values, list):
                        shap_arr = shap_values[0][0]
                    else:
                        shap_arr = shap_values[0]

                    feature_values: list[int] = [req_size, res_size, latency]

                    abs_shap = np.abs(shap_arr)
                    max_idx: int = int(np.argmax(abs_shap))
                    primary_feature: str = FEATURE_NAMES[max_idx]
                    primary_value: int = feature_values[max_idx]

                    logger.warning(
                        "ANOMALY detected for tenant %s | Primary driver: %s (Value: %s) | Score: %.4f",
                        tenant_id,
                        primary_feature,
                        primary_value,
                        score,
                    )

                    send_alert(
                        tenant_id,
                        f"Isolation Forest detected abnormal traffic. Driven primarily by {primary_feature} (Value: {primary_value})",
                        {
                            "latencyMs": latency,
                            "requestByteSize": req_size,
                            "primaryFeature": primary_feature,
                            "primaryValue": primary_value,
                        },
                    )
                else:
                    logger.info(
                        "Traffic Normal | Tenant: %s | Latency: %dms | Score: %.4f",
                        tenant_id,
                        latency,
                        score,
                    )

    except KeyboardInterrupt:
        logger.info("Shutting down AI worker...")

    finally:
        consumer.close()
        logger.info("Kafka Consumer closed")


if __name__ == "__main__":
    start_consumer()
