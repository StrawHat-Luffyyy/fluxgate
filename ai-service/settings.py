"""Environment-driven settings. Deliberately a plain dataclass, no settings framework."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Optional

DEFAULT_MODEL_DIR = str(Path(__file__).resolve().parent / "models")


class SettingsError(Exception):
    """Raised at startup when configuration is unusable."""


@dataclass(frozen=True)
class Settings:
    kafka_brokers: str
    kafka_topic: str
    kafka_dlq_topic: str
    kafka_group_id: str
    alert_endpoint: str
    internal_alert_secret: str
    model_dir: str
    model_version: Optional[str]
    health_port: int
    log_level: str
    range_guard_multiplier: float = 10.0

    @classmethod
    def from_env(cls, env: Optional[Mapping[str, str]] = None) -> "Settings":
        env = os.environ if env is None else env

        def get(name: str, default: str = "") -> str:
            value = env.get(name)
            return default if value is None or value.strip() == "" else value.strip()

        secret = get("INTERNAL_ALERT_SECRET")
        if not secret:
            raise SettingsError("INTERNAL_ALERT_SECRET is required and must not be empty")

        try:
            health_port = int(get("HEALTH_PORT", "8090"))
        except ValueError as exc:
            raise SettingsError("HEALTH_PORT must be an integer") from exc
        if not 0 <= health_port <= 65535:
            raise SettingsError("HEALTH_PORT out of range")

        try:
            multiplier = float(get("RANGE_GUARD_MULTIPLIER", "10"))
        except ValueError as exc:
            raise SettingsError("RANGE_GUARD_MULTIPLIER must be a number") from exc
        if multiplier < 0:
            raise SettingsError("RANGE_GUARD_MULTIPLIER must be >= 0 (0 disables)")

        return cls(
            kafka_brokers=get("KAFKA_BROKERS", "localhost:19092"),
            kafka_topic=get("KAFKA_TOPIC", "gateway.traffic.logs"),
            kafka_dlq_topic=get("KAFKA_DLQ_TOPIC", "gateway.traffic.dlq"),
            kafka_group_id=get("KAFKA_GROUP_ID", "fluxgate-ai-workers"),
            alert_endpoint=get("ALERT_ENDPOINT", "http://localhost:3000/internal/alerts"),
            internal_alert_secret=secret,
            model_dir=get("MODEL_DIR", DEFAULT_MODEL_DIR),
            model_version=get("MODEL_VERSION") or None,
            health_port=health_port,
            log_level=get("LOG_LEVEL", "INFO").upper(),
            range_guard_multiplier=multiplier,
        )
