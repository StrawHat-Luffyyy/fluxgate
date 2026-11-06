"""Health state and a tiny stdlib HTTP server exposing GET /health."""

from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Optional


class HealthState:
    def __init__(self, model_version: str = ""):
        self._lock = threading.Lock()
        self.model_version = model_version
        self.started = False
        self.fatal = False
        self.kafka_connected = False
        self.alerts_failing = False
        self.last_message_at: Optional[float] = None
        self.processed = 0
        self.anomalies = 0
        self.dlq = 0
        self.alert_failures = 0

    def update(self, **fields) -> None:
        with self._lock:
            for key, value in fields.items():
                setattr(self, key, value)

    def incr(self, **fields: int) -> None:
        with self._lock:
            for key, value in fields.items():
                setattr(self, key, getattr(self, key) + value)

    def message_seen(self) -> None:
        with self._lock:
            self.last_message_at = datetime.now(timezone.utc).timestamp()

    def snapshot(self) -> tuple[int, dict]:
        """Return (http_status, body). 503 if the loop is not running or hit a fatal error."""
        with self._lock:
            healthy = self.started and not self.fatal
            degraded = (not self.kafka_connected) or self.alerts_failing
            last = (
                datetime.fromtimestamp(self.last_message_at, timezone.utc)
                .isoformat(timespec="milliseconds")
                .replace("+00:00", "Z")
                if self.last_message_at
                else None
            )
            body = {
                "status": "ok" if healthy and not degraded else "degraded",
                "modelVersion": self.model_version,
                "kafkaConnected": self.kafka_connected,
                "lastMessageAt": last,
                "processed": self.processed,
                "anomalies": self.anomalies,
                "dlq": self.dlq,
                "alertFailures": self.alert_failures,
            }
            return (200 if healthy else 503), body


def make_handler(state: HealthState):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 (stdlib naming)
            if self.path.split("?", 1)[0] != "/health":
                self.send_error(404)
                return
            code, body = state.snapshot()
            data = json.dumps(body).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, format, *args):  # silence per-request stderr noise
            pass

    return Handler


def start_health_server(state: HealthState, port: int, host: str = "0.0.0.0") -> ThreadingHTTPServer:
    server = ThreadingHTTPServer((host, port), make_handler(state))
    threading.Thread(target=server.serve_forever, name="health", daemon=True).start()
    return server
