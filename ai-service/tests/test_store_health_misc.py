import json
import urllib.error
import urllib.request

import pytest

from health import HealthState, start_health_server
from model_store import ModelStoreError, load_model, write_version
from settings import Settings, SettingsError
from tracing import extract_trace_context


def test_model_store_roundtrip_and_latest(tmp_path, trained):
    model, baseline, _ = trained
    write_version(str(tmp_path), "v9-test", model, baseline, {"hyperparameters": {}})
    assert (tmp_path / "LATEST").read_text().strip() == "v9-test"
    loaded = load_model(str(tmp_path))
    assert loaded.version == "v9-test" and len(loaded.baseline) == len(baseline)


def test_sha_mismatch_refuses(tmp_path, trained):
    model, baseline, _ = trained
    vdir = write_version(str(tmp_path), "v9-test", model, baseline, {})
    with open(vdir / "model.joblib", "ab") as f:
        f.write(b"tamper")
    with pytest.raises(ModelStoreError, match="sha256 mismatch"):
        load_model(str(tmp_path), "v9-test")


def test_versions_are_immutable_and_path_traversal_refused(tmp_path, trained):
    model, baseline, _ = trained
    write_version(str(tmp_path), "v9-test", model, baseline, {})
    with pytest.raises(ModelStoreError):
        write_version(str(tmp_path), "v9-test", model, baseline, {})
    with pytest.raises(ModelStoreError):
        load_model(str(tmp_path), "../x")


def get(port):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/health") as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.load(e)


def test_health_endpoint_states():
    state = HealthState("vtest")
    srv = start_health_server(state, 0, "127.0.0.1")
    try:
        port = srv.server_port
        code, body = get(port)
        assert code == 503  # loop not started
        state.update(started=True, kafka_connected=True)
        state.incr(processed=3, anomalies=1)
        code, body = get(port)
        assert code == 200 and body["status"] == "ok" and body["processed"] == 3 and body["modelVersion"] == "vtest"
        assert set(body) == {"status", "modelVersion", "kafkaConnected", "lastMessageAt", "processed", "anomalies",
                             "dlq", "alertFailures"}
        state.update(kafka_connected=False)
        code, body = get(port)
        assert code == 200 and body["status"] == "degraded"
        state.update(fatal=True)
        assert get(port)[0] == 503
        with pytest.raises(urllib.error.HTTPError):
            urllib.request.urlopen(f"http://127.0.0.1:{port}/nope")
    finally:
        srv.shutdown()


def test_settings_require_secret_and_defaults():
    with pytest.raises(SettingsError):
        Settings.from_env({})
    with pytest.raises(SettingsError):
        Settings.from_env({"INTERNAL_ALERT_SECRET": "  "})
    s = Settings.from_env({"INTERNAL_ALERT_SECRET": "x"})
    assert s.kafka_dlq_topic == "gateway.traffic.dlq" and s.health_port == 8090 and s.model_version is None
    assert s.range_guard_multiplier == 10
    assert Settings.from_env({"INTERNAL_ALERT_SECRET": "x", "RANGE_GUARD_MULTIPLIER": "0"}).range_guard_multiplier == 0


def test_trace_context_extraction():
    tp = "00-" + "a" * 32 + "-" + "b" * 16 + "-01"
    assert extract_trace_context([("traceparent", tp.encode())]).trace_id == "a" * 32
    assert extract_trace_context([("traceparent", b"garbage")]).traceparent is None
    assert extract_trace_context(None).traceparent is None
