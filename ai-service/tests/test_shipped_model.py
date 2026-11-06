"""
Regression tests against the model artifact actually committed in models/, not a
small fixture. These guard the behaviour the README describes.
"""

from pathlib import Path

import pytest

from model_store import load_model
from scoring import Scorer


@pytest.fixture(scope="module")
def shipped():
    loaded = load_model(str(Path(__file__).resolve().parent.parent / "models"))
    return Scorer(loaded.model, loaded.baseline, loaded.version, loaded.metadata.get("featureMax"))


def score(scorer, request_bytes, response_bytes, latency_ms):
    return scorer.score(
        {
            "requestByteSize": request_bytes,
            "responseByteSize": response_bytes,
            "latencyMs": latency_ms,
        }
    )


@pytest.mark.parametrize(
    "request_bytes,response_bytes,latency_ms",
    [
        (0, 0, 15),  # 204
        (0, 0, 150),  # 204
        (0, 0, 20),  # 304
        (0, 150, 25),  # Small error body
        (0, 3000, 80),  # Typical GET
        (800, 400, 120),  # Typical POST
    ],
)
def test_ordinary_traffic_is_not_flagged(shipped, request_bytes, response_bytes, latency_ms):
    result = score(shipped, request_bytes, response_bytes, latency_ms)
    assert result.is_anomaly is False


@pytest.mark.parametrize(
    "request_bytes,response_bytes,latency_ms,top_feature",
    [
        (0, 3000, 30_000, "latencyMs"),
        (0, 500_000_000, 100, "responseByteSize"),
        (200_000_000, 400, 100, "requestByteSize"),
    ],
)
def test_extreme_outliers_are_caught_by_the_range_guard(
    shipped, request_bytes, response_bytes, latency_ms, top_feature
):
    result = score(shipped, request_bytes, response_bytes, latency_ms)
    assert result.is_anomaly is True
    assert result.detector == "range_guard"
    assert result.top_feature == top_feature


def test_known_gap_slow_requests_below_the_guard_are_not_flagged(shipped):
    """Documents a limitation in the README. If this starts failing, update the README."""
    result = score(shipped, 0, 3000, 5_000)
    assert result.is_anomaly is False
