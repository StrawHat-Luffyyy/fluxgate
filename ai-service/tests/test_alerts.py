import hashlib
import hmac
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
import requests

from alerts import AlertClient, PermanentAlertError, TransientAlertError, build_payload, serialize, sign
from scoring import ScoreResult, TrafficEvent
from tracing import TraceContext

SECRET = "s3cret"


def test_signature_matches_independent_computation():
    body = b'{"a":1}'
    t = 1700000000
    expected = hmac.new(SECRET.encode(), f"{t}.".encode() + body, hashlib.sha256).hexdigest()
    assert sign(SECRET, t, body) == f"t={t},v1={expected}"


def sample_payload(detector="forest"):
    ev = TrafficEvent("r-1", "t-1", False, {"requestByteSize": 0.0, "responseByteSize": 5.0, "latencyMs": 30000.0})
    res = ScoreResult(-0.1, True, {"requestByteSize": 0.0, "responseByteSize": 0.1, "latencyMs": -0.4}, "latencyMs",
                      30000.0, detector=detector, guard_limit=14480.0)
    return build_payload(ev, res, "vtest")


def test_payload_contract_fields():
    p = sample_payload()
    assert set(p) == {"tenantId", "alertType", "requestId", "score", "modelVersion", "topFeature", "topFeatureValue",
                      "attribution", "features", "message", "detectedAt", "detector"}
    assert p["alertType"] == "anomaly_detected" and p["detectedAt"].endswith("Z")


class Resp:
    def __init__(self, code, body=None):
        self.status_code = code
        self._body = body

    def json(self):
        if self._body is None:
            raise ValueError("no json")
        return self._body


class FakeSession:
    def __init__(self, *outcomes):
        self.outcomes = list(outcomes)
        self.calls = []

    def post(self, url, data=None, headers=None, **kw):
        self.calls.append((url, data, headers))
        o = self.outcomes.pop(0)
        if isinstance(o, Exception):
            raise o
        return Resp(*o) if isinstance(o, tuple) else Resp(o)


def client(session, **kw):
    return AlertClient("http://x/a", SECRET, session=session, sleep=lambda s: None, clock=lambda: 1700000000, **kw)


def test_success_signs_exact_bytes_and_headers():
    s = FakeSession(200)
    trace = TraceContext("00-" + "a" * 32 + "-" + "b" * 16 + "-01", "k=v")
    client(s).send(sample_payload(), "r-1", trace)
    _, data, h = s.calls[0]
    assert isinstance(data, bytes)
    assert h["X-FluxGate-Signature"] == sign(SECRET, 1700000000, data)
    assert h["X-Request-Id"] == "r-1" and h["traceparent"] == trace.traceparent and h["tracestate"] == "k=v"
    assert h["Content-Type"] == "application/json"


def test_retry_on_503_then_success_resends_same_bytes():
    s = FakeSession(503, 429, requests.ConnectionError("down"), 202)
    client(s).send(sample_payload(), "r-1")
    assert len(s.calls) == 4
    assert len({c[1] for c in s.calls}) == 1


def test_no_retry_on_400():
    s = FakeSession(400)
    with pytest.raises(PermanentAlertError):
        client(s).send(sample_payload(), "r-1")
    assert len(s.calls) == 1


def test_408_is_transient_and_exhaustion_raises():
    s = FakeSession(408, 408, 408)
    with pytest.raises(TransientAlertError):
        client(s, max_attempts=3).send(sample_payload(), "r-1")
    assert len(s.calls) == 3


def test_real_http_server_receives_verifiable_signature():
    seen = {}

    class H(BaseHTTPRequestHandler):
        def do_POST(self):
            body = self.rfile.read(int(self.headers["Content-Length"]))
            seen.update(body=body, sig=self.headers["X-FluxGate-Signature"], rid=self.headers["X-Request-Id"])
            self.send_response(200)
            self.send_header("Content-Length", "0")
            self.end_headers()

        def log_message(self, *a):
            pass

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        AlertClient(f"http://127.0.0.1:{srv.server_port}/internal/alerts", SECRET).send(sample_payload(), "r-1")
    finally:
        srv.shutdown()
    t = int(seen["sig"].split(",")[0][2:])
    assert seen["sig"] == sign(SECRET, t, seen["body"])
    assert json.loads(seen["body"])["requestId"] == "r-1"
    assert seen["body"] == serialize(json.loads(seen["body"]))


def test_range_guard_payload_is_honest():
    p = sample_payload("range_guard")
    assert p["detector"] == "range_guard"
    assert "Isolation Forest flagged" not in p["message"] and "range guard" in p["message"]
    assert "Isolation Forest flagged" in sample_payload("forest")["message"]


@pytest.mark.parametrize("status", [401, 403, 404, 500])
def test_auth_and_routing_failures_are_transient(status):
    s = FakeSession(*([status] * 3))
    with pytest.raises(TransientAlertError):
        client(s, max_attempts=3).send(sample_payload(), "r-1")
    assert len(s.calls) == 3


def test_404_tenant_not_found_is_permanent():
    s = FakeSession((404, {"error": "TENANT_NOT_FOUND"}))
    with pytest.raises(PermanentAlertError):
        client(s).send(sample_payload(), "r-1")
    assert len(s.calls) == 1


def test_404_other_json_is_transient():
    with pytest.raises(TransientAlertError):
        client(FakeSession(*([(404, {"error": "NOPE"})] * 2)), max_attempts=2).send(sample_payload(), "r-1")


def test_422_is_permanent():
    with pytest.raises(PermanentAlertError):
        client(FakeSession(422)).send(sample_payload(), "r-1")
