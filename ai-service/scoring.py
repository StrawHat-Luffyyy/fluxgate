"""Message validation, feature extraction, Isolation Forest scoring and SHAP attribution.

No Kafka or HTTP in here, so it is unit-testable on its own.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Optional

import numpy as np

FEATURE_NAMES: list[str] = ["requestByteSize", "responseByteSize", "latencyMs"]


class InvalidMessage(ValueError):
    """The Kafka payload does not satisfy the gateway contract (goes to the DLQ)."""


@dataclass(frozen=True)
class TrafficEvent:
    request_id: str
    tenant_id: str
    rate_limited: bool
    features: Optional[dict[str, float]]  # None when not scored
    upstream_called: bool = True

    @property
    def skip(self) -> bool:
        """Rate-limited or gateway-answered requests never reached an upstream: not scored."""
        return self.rate_limited or not self.upstream_called


@dataclass(frozen=True)
class ScoreResult:
    score: float
    is_anomaly: bool
    attribution: Optional[dict[str, float]] = None
    top_feature: Optional[str] = None
    top_feature_value: Optional[float] = None
    detector: Optional[str] = None  # "forest" or "range_guard"
    guard_limit: Optional[float] = None  # raw-unit limit that was exceeded (range_guard only)


def _required_str(payload: dict, key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise InvalidMessage(f"field {key!r} missing or not a non-empty string")
    return value


def _feature_number(payload: dict, key: str) -> float:
    value = payload.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise InvalidMessage(f"field {key!r} missing or not numeric")
    value = float(value)
    if not math.isfinite(value) or value < 0:
        raise InvalidMessage(f"field {key!r} must be a finite non-negative number")
    return value


def parse_event(payload: Any) -> TrafficEvent:
    """Validate a decoded JSON payload. Rate-limited requests skip feature validation."""
    if not isinstance(payload, dict):
        raise InvalidMessage("payload is not a JSON object")
    request_id = _required_str(payload, "requestId")
    tenant_id = _required_str(payload, "tenantId")
    rate_limited = payload.get("rateLimited", False)
    if not isinstance(rate_limited, bool):
        raise InvalidMessage("field 'rateLimited' must be a boolean")
    upstream_called = payload.get("upstreamCalled", True)  # old messages lack it: assume true
    if not isinstance(upstream_called, bool):
        raise InvalidMessage("field 'upstreamCalled' must be a boolean")
    if rate_limited or not upstream_called:
        return TrafficEvent(request_id, tenant_id, rate_limited, None, upstream_called)
    features = {name: _feature_number(payload, name) for name in FEATURE_NAMES}
    return TrafficEvent(request_id, tenant_id, False, features, True)


def to_model_space(rows: np.ndarray) -> np.ndarray:
    """log1p: raw bytes/latency are heavy-tailed, the forest works on the log scale."""
    return np.log1p(np.asarray(rows, dtype=float))


# Isolation Forest scores saturate for points beyond the training range (they land in the same
# outermost leaves as the training extremes), so a 30 s latency can score no worse than a 600 ms
# one. This guard flags any feature above multiplier x the training maximum (0 disables it).
DEFAULT_GUARD_MULTIPLIER = 10.0


class Scorer:
    def __init__(
        self,
        model: Any,
        baseline_raw: np.ndarray,
        version: str,
        feature_max: Optional[dict[str, float]] = None,
        guard_multiplier: float = DEFAULT_GUARD_MULTIPLIER,
    ):
        self.guard_multiplier = guard_multiplier
        self.model = model
        self.version = version
        self.feature_max = feature_max or {}
        self._baseline = to_model_space(baseline_raw)
        self._explainer = None

    def _get_explainer(self):
        if self._explainer is None:
            import shap  # imported lazily: slow import

            self._explainer = shap.TreeExplainer(self.model, data=self._baseline)
        return self._explainer

    def score(self, features: dict[str, float]) -> ScoreResult:
        raw = np.array([[features[n] for n in FEATURE_NAMES]], dtype=float)
        x = to_model_space(raw)
        score = float(self.model.decision_function(x)[0])
        forest_flag = int(self.model.predict(x)[0]) == -1

        # Range guard: feature -> exceedance ratio over the training maximum.
        exceeded = {
            n: features[n] / self.feature_max[n]
            for n in FEATURE_NAMES
            if self.guard_multiplier > 0
            and self.feature_max.get(n, 0) > 0
            and features[n] > self.guard_multiplier * self.feature_max[n]
        }
        if not forest_flag and not exceeded:
            return ScoreResult(score=score, is_anomaly=False)

        attribution, top = self.explain(x)
        # When both fire, the guard names the feature that is literally out of range,
        # which is more specific than a SHAP ranking of a saturated forest score.
        if exceeded:
            top = max(exceeded, key=exceeded.get)
        return ScoreResult(
            score=score,
            is_anomaly=True,
            attribution=attribution,
            top_feature=top,
            top_feature_value=float(features[top]),  # raw units, not log space
            detector="range_guard" if exceeded else "forest",
            guard_limit=self.guard_multiplier * self.feature_max[top] if exceeded else None,
        )

    def explain(self, x_model_space: np.ndarray) -> tuple[dict[str, float], str]:
        """SHAP values (in log1p space) keyed by original feature name, plus the top |shap| feature."""
        values = self._get_explainer().shap_values(x_model_space)
        if isinstance(values, list):
            values = values[0]
        row = np.asarray(values).reshape(-1, len(FEATURE_NAMES))[0]
        attribution = {name: float(v) for name, v in zip(FEATURE_NAMES, row)}
        top = FEATURE_NAMES[int(np.argmax(np.abs(row)))]
        return attribution, top
