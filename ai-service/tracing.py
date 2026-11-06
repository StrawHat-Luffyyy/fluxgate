"""Minimal W3C trace-context handling. We only need to log the trace id and forward the headers."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable, Optional, Tuple

_TRACEPARENT = re.compile(r"^[0-9a-f]{2}-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$")


@dataclass(frozen=True)
class TraceContext:
    traceparent: Optional[str] = None
    tracestate: Optional[str] = None

    @property
    def trace_id(self) -> Optional[str]:
        if not self.traceparent:
            return None
        match = _TRACEPARENT.match(self.traceparent)
        return match.group(1) if match else None


def extract_trace_context(headers: Optional[Iterable[Tuple[str, object]]]) -> TraceContext:
    """Pull traceparent/tracestate out of Kafka headers. An invalid traceparent is dropped."""
    found: dict[str, str] = {}
    for key, value in headers or []:
        if value is None or not isinstance(key, str):
            continue
        if isinstance(value, bytes):
            try:
                value = value.decode("utf-8")
            except UnicodeDecodeError:
                continue
        found[key.lower()] = str(value).strip()

    traceparent = found.get("traceparent")
    ctx = TraceContext(traceparent=traceparent, tracestate=found.get("tracestate"))
    if ctx.trace_id is None or set(ctx.trace_id) == {"0"}:
        return TraceContext()
    return ctx
