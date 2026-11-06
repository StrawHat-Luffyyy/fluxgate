import json

import pytest

from alerts import PermanentAlertError, TransientAlertError
from consumer import DeadLetterQueue, Outcome, Processor
from health import HealthState
from tests.conftest import good_message


class FakeMsg:
    def __init__(self, value, headers=None, offset=7):
        self._v, self._h, self._o = value, headers, offset

    def value(self): return self._v
    def key(self): return b"k"
    def headers(self): return self._h
    def topic(self): return "logs"
    def partition(self): return 0
    def offset(self): return self._o
    def error(self): return None


class FakeProducer:
    def __init__(self, fail=False):
        self.records, self.fail = [], fail

    def produce(self, topic, value=None, key=None, headers=None, on_delivery=None):
        self.records.append((topic, value, key, headers))
        if on_delivery:
            on_delivery("boom" if self.fail else None, None)

    def flush(self, timeout=None):
        return 0


class FakeAlerts:
    def __init__(self, exc=None):
        self.exc, self.sent = exc, []

    def send(self, payload, request_id, trace=None):
        if self.exc:
            raise self.exc
        self.sent.append((payload, request_id, trace))


def make(scorer, alerts=None, producer=None):
    health = HealthState("vtest")
    producer = producer or FakeProducer()
    return Processor(scorer, alerts or FakeAlerts(), DeadLetterQueue(producer, "dlq"), health), health, producer


def enc(**over):
    return json.dumps(good_message(**over)).encode()


def test_normal_commits_without_alert(scorer):
    p, h, prod = make(scorer)
    assert p.handle(FakeMsg(enc())) is Outcome.COMMIT
    assert p.alerts.sent == [] and prod.records == [] and h.processed == 1


def test_rate_limited_skipped_and_committed(scorer):
    p, h, prod = make(scorer)
    assert p.handle(FakeMsg(enc(rateLimited=True, latencyMs=99999999))) is Outcome.COMMIT
    assert p.alerts.sent == [] and prod.records == []


def test_anomaly_alerts_and_commits_with_trace(scorer):
    p, h, _ = make(scorer)
    tp = "00-" + "a" * 32 + "-" + "b" * 16 + "-01"
    assert p.handle(FakeMsg(enc(latencyMs=30000), [("traceparent", tp.encode())])) is Outcome.COMMIT
    payload, rid, trace = p.alerts.sent[0]
    assert payload["topFeature"] == "latencyMs" and rid == "r-1" and trace.traceparent == tp
    assert h.anomalies == 1


@pytest.mark.parametrize("raw", [b"not json", b"\xff\xfe", b"[]", None, json.dumps({"requestId": "x"}).encode()])
def test_malformed_goes_to_dlq_and_commits(scorer, raw):
    p, h, prod = make(scorer)
    assert p.handle(FakeMsg(raw)) is Outcome.COMMIT
    topic, value, key, headers = prod.records[0]
    assert topic == "dlq" and value == raw
    assert any(k == "x-dlq-error" for k, _ in headers)
    assert h.dlq == 1


def test_permanent_alert_rejection_goes_to_dlq(scorer):
    p, h, prod = make(scorer, FakeAlerts(PermanentAlertError("400")))
    assert p.handle(FakeMsg(enc(latencyMs=30000))) is Outcome.COMMIT
    assert len(prod.records) == 1


def test_transient_exhaustion_does_not_commit_and_degrades_health(scorer):
    p, h, prod = make(scorer, FakeAlerts(TransientAlertError("503")))
    h.update(started=True, kafka_connected=True)
    assert p.handle(FakeMsg(enc(latencyMs=30000))) is Outcome.RETRY
    assert prod.records == [] and h.alert_failures == 1
    code, body = h.snapshot()
    assert code == 200 and body["status"] == "degraded" and body["alertFailures"] == 1


def test_dlq_failure_does_not_commit(scorer):
    p, _, _ = make(scorer, producer=FakeProducer(fail=True))
    assert p.handle(FakeMsg(b"garbage")) is Outcome.RETRY


def test_unexpected_exception_does_not_crash(scorer):
    class Boom:
        version = "v"

        def score(self, f):
            raise RuntimeError("bug")

    p, _, prod = make(scorer)
    p.scorer = Boom()
    assert p.handle(FakeMsg(enc())) is Outcome.COMMIT
    assert len(prod.records) == 1
