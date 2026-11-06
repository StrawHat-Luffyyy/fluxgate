"""Alert construction, HMAC signing and delivery with retries."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import random
import time
from datetime import datetime, timezone
from typing import Callable, Optional

import requests

from scoring import FEATURE_NAMES, ScoreResult, TrafficEvent
from tracing import TraceContext

logger = logging.getLogger("fluxgate.alerts")

PERMANENT_STATUS = {400, 422}


def _is_permanent(resp) -> bool:
    if resp.status_code in PERMANENT_STATUS:
        return True
    if resp.status_code == 404:  # a deleted tenant is the one permanent 404
        try:
            body = resp.json()
        except Exception:
            return False
        return isinstance(body, dict) and body.get("error") == "TENANT_NOT_FOUND"
    return False


class AlertError(Exception):
    pass


class PermanentAlertError(AlertError):
    """The gateway rejected the alert; retrying cannot help (send to DLQ)."""


class TransientAlertError(AlertError):
    """Delivery failed after all retries; the message must be reprocessed later."""


def sign(secret: str, timestamp: int, body: bytes) -> str:
    """Header value `t=<ts>,v1=<hex>`; HMAC-SHA256 over `"<ts>." + body`."""
    mac = hmac.new(secret.encode("utf-8"), f"{timestamp}.".encode("ascii") + body, hashlib.sha256)
    return f"t={timestamp},v1={mac.hexdigest()}"


# Alert messages are shown to people, who should not need the wire names.
FEATURE_LABELS = {
    "requestByteSize": ("Request size", "bytes"),
    "responseByteSize": ("Response size", "bytes"),
    "latencyMs": ("Latency", "ms"),
}


def _message(result: ScoreResult) -> str:
    top, value = result.top_feature, result.top_feature_value
    label, unit = FEATURE_LABELS.get(top, (top, ""))
    amount = f"{value:,.0f} {unit}".rstrip()
    if result.detector == "range_guard":
        forest = "also flagged it" if result.forest_flagged else "did not flag it"
        return (
            f"{label} {amount} exceeds the range guard limit {f'{result.guard_limit:,.0f} {unit}'.rstrip()} "
            f"(a multiple of the largest value in the training data); the Isolation Forest {forest}"
        )
    return f"Isolation Forest flagged abnormal traffic, driven mainly by {label.lower()} ({amount})"


def build_payload(event: TrafficEvent, result: ScoreResult, model_version: str, now: Optional[datetime] = None) -> dict:
    assert event.features is not None and result.attribution is not None and result.top_feature
    now = now or datetime.now(timezone.utc)
    return {
        "tenantId": event.tenant_id,
        "alertType": "anomaly_detected",
        "requestId": event.request_id,
        "score": result.score,
        "modelVersion": model_version,
        "topFeature": result.top_feature,
        "topFeatureValue": result.top_feature_value,
        "attribution": {n: result.attribution[n] for n in FEATURE_NAMES},
        "features": {n: event.features[n] for n in FEATURE_NAMES},
        "detector": result.detector,
        "message": _message(result),
        "detectedAt": now.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    }


def serialize(payload: dict) -> bytes:
    return json.dumps(payload, separators=(",", ":"), allow_nan=False).encode("utf-8")


class AlertClient:
    def __init__(
        self,
        endpoint: str,
        secret: str,
        max_attempts: int = 5,
        base_delay: float = 0.5,
        max_delay: float = 8.0,
        timeout: float = 5.0,
        session: Optional[requests.Session] = None,
        sleep: Callable[[float], object] = time.sleep,
        clock: Callable[[], float] = time.time,
    ):
        self.endpoint = endpoint
        self.secret = secret
        self.max_attempts = max_attempts
        self.base_delay = base_delay
        self.max_delay = max_delay
        self.timeout = timeout
        self.session = session or requests.Session()
        self.sleep = sleep
        self.clock = clock

    def _backoff(self, attempt: int) -> float:
        ceiling = min(self.max_delay, self.base_delay * (2**attempt))
        return ceiling / 2 + random.uniform(0, ceiling / 2)  # equal jitter

    def send(self, payload: dict, request_id: str, trace: Optional[TraceContext] = None) -> None:
        """Returns on 2xx. Raises PermanentAlertError (non-retryable 4xx) or TransientAlertError."""
        body = serialize(payload)  # serialized once; the signed bytes are the bytes on the wire
        last_error = "unknown"
        for attempt in range(self.max_attempts):
            headers = {
                "Content-Type": "application/json",
                # Fresh timestamp per attempt so retries do not fall outside the receiver's replay window.
                "X-FluxGate-Signature": sign(self.secret, int(self.clock()), body),
                "X-Request-Id": request_id,
            }
            if trace and trace.traceparent:
                headers["traceparent"] = trace.traceparent
                if trace.tracestate:
                    headers["tracestate"] = trace.tracestate
            try:
                resp = self.session.post(
                    self.endpoint, data=body, headers=headers, timeout=self.timeout, allow_redirects=False
                )
            except requests.RequestException as exc:
                last_error = f"{type(exc).__name__}: {exc}"
            else:
                status = resp.status_code
                if 200 <= status < 300:
                    return
                if _is_permanent(resp):
                    raise PermanentAlertError(f"gateway rejected alert with HTTP {status}")
                # Everything else (5xx, 408, 429, and 401/403/404 which mean a rotated secret, clock
                # skew or a wrong endpoint) is operational: retry, never DLQ, surface via health.
                last_error = f"HTTP {status}"

            if attempt < self.max_attempts - 1:
                delay = self._backoff(attempt)
                logger.warning(
                    "alert delivery failed, retrying",
                    extra={"requestId": request_id, "attempt": attempt + 1, "error": last_error, "delaySec": round(delay, 2)},
                )
                self.sleep(delay)
        raise TransientAlertError(f"alert delivery failed after {self.max_attempts} attempts: {last_error}")
