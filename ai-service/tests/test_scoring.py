import numpy as np
import pytest

from scoring import FEATURE_NAMES, InvalidMessage, parse_event
from tests.conftest import good_message


def test_parse_valid_event():
    ev = parse_event(good_message())
    assert ev.request_id == "r-1" and ev.tenant_id == "t-1" and not ev.rate_limited
    assert ev.features == {"requestByteSize": 0.0, "responseByteSize": 3000.0, "latencyMs": 60.0}


def test_rate_limited_is_skipped_without_feature_validation():
    ev = parse_event({"requestId": "r", "tenantId": "t", "rateLimited": True})
    assert ev.rate_limited and ev.features is None


@pytest.mark.parametrize("field", ["requestByteSize", "responseByteSize", "latencyMs"])
def test_missing_feature_rejected(field):
    msg = good_message()
    del msg[field]
    with pytest.raises(InvalidMessage):
        parse_event(msg)


@pytest.mark.parametrize("bad", ["12", None, True, [1], float("nan"), float("inf"), -5])
def test_bad_feature_values_rejected(bad):
    with pytest.raises(InvalidMessage):
        parse_event(good_message(latencyMs=bad))


@pytest.mark.parametrize(
    "payload",
    [[], "str", 5, None, {}, good_message(tenantId=""), good_message(requestId=3), good_message(rateLimited="yes")],
)
def test_bad_envelope_rejected(payload):
    with pytest.raises(InvalidMessage):
        parse_event(payload)


def test_normal_traffic_not_flagged(scorer):
    assert not scorer.score({"requestByteSize": 0, "responseByteSize": 3000, "latencyMs": 60}).is_anomaly
    assert not scorer.score({"requestByteSize": 800, "responseByteSize": 400, "latencyMs": 120}).is_anomaly


def test_get_with_zero_request_bytes_is_normal(scorer):
    # regression: the old model trained on ~500 request bytes flagged every GET
    assert not scorer.score({"requestByteSize": 0, "responseByteSize": 2500, "latencyMs": 50}).is_anomaly


def test_outlier_attribution_shape_and_top_feature(scorer):
    r = scorer.score({"requestByteSize": 0, "responseByteSize": 3000, "latencyMs": 30_000})
    assert r.is_anomaly
    assert set(r.attribution) == set(FEATURE_NAMES)
    assert all(isinstance(v, float) for v in r.attribution.values())
    assert r.top_feature == "latencyMs"
    assert r.top_feature_value == 30_000  # raw units, not log space


def test_top_feature_for_huge_response(scorer):
    r = scorer.score({"requestByteSize": 0, "responseByteSize": 500_000_000, "latencyMs": 60})
    assert r.is_anomaly
    assert r.top_feature == "responseByteSize"
    assert r.top_feature_value == 500_000_000


def test_forest_flagged_top_feature_is_max_abs_shap(scorer):
    r = scorer.score({"requestByteSize": 0, "responseByteSize": 0, "latencyMs": 1})
    assert r.is_anomaly  # flagged by the forest itself, not the range guard
    assert r.top_feature == max(r.attribution, key=lambda k: abs(r.attribution[k]))


def test_explain_returns_named_dict(scorer):
    attr, top = scorer.explain(np.log1p(np.array([[0.0, 3000.0, 30000.0]])))
    assert list(attr) == FEATURE_NAMES and top in FEATURE_NAMES
