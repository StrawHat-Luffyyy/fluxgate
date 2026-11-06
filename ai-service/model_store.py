"""Versioned model artifacts: models/<version>/{model.joblib,baseline.joblib,metadata.json}.

SECURITY: joblib (like pickle) executes arbitrary code when loading. Artifacts must therefore be
treated as trusted code and integrity-checked. Every load verifies the SHA-256 recorded in
metadata.json and refuses on a mismatch. This protects against corruption and accidental
overwrite; it does not protect against an attacker who can rewrite both an artifact and its
metadata.json, so the models directory must only be writable by the deploy pipeline.
"""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

import joblib

MODEL_FILE = "model.joblib"
BASELINE_FILE = "baseline.joblib"
METADATA_FILE = "metadata.json"
LATEST_FILE = "LATEST"
ARTIFACT_FILES = (MODEL_FILE, BASELINE_FILE)


class ModelStoreError(Exception):
    """Artifacts are missing, inconsistent, or fail integrity verification."""


@dataclass
class LoadedModel:
    version: str
    model: Any
    baseline: Any
    metadata: dict


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_version(model_dir: str, requested: Optional[str] = None) -> str:
    if requested:
        return requested
    latest = Path(model_dir) / LATEST_FILE
    if not latest.is_file():
        raise ModelStoreError(f"no MODEL_VERSION given and {latest} does not exist")
    version = latest.read_text(encoding="utf-8").strip()
    if not version:
        raise ModelStoreError(f"{latest} is empty")
    return version


def load_model(model_dir: str, requested_version: Optional[str] = None) -> LoadedModel:
    version = resolve_version(model_dir, requested_version)
    if "/" in version or "\\" in version or version in (".", ".."):
        raise ModelStoreError(f"invalid model version: {version!r}")
    vdir = Path(model_dir) / version
    meta_path = vdir / METADATA_FILE
    if not meta_path.is_file():
        raise ModelStoreError(f"model version {version!r} not found at {vdir}")
    metadata = json.loads(meta_path.read_text(encoding="utf-8"))
    expected = metadata.get("sha256", {})

    for name in ARTIFACT_FILES:
        path = vdir / name
        if not path.is_file():
            raise ModelStoreError(f"missing artifact {path}")
        want = expected.get(name)
        if not want:
            raise ModelStoreError(f"metadata for {version} has no sha256 for {name}")
        got = sha256_file(path)
        if got != want:
            raise ModelStoreError(
                f"sha256 mismatch for {path}: expected {want}, got {got}; refusing to load"
            )

    # Only reached after verification.
    model = joblib.load(vdir / MODEL_FILE)
    baseline = joblib.load(vdir / BASELINE_FILE)
    return LoadedModel(version=metadata.get("version", version), model=model, baseline=baseline, metadata=metadata)


def write_version(model_dir: str, version: str, model: Any, baseline: Any, metadata: dict) -> Path:
    """Write a new immutable version directory and point LATEST at it."""
    root = Path(model_dir)
    vdir = root / version
    if vdir.exists():
        raise ModelStoreError(f"version {version} already exists; versions are immutable")
    vdir.mkdir(parents=True)
    joblib.dump(model, vdir / MODEL_FILE)
    joblib.dump(baseline, vdir / BASELINE_FILE)
    metadata = dict(metadata)
    metadata["version"] = version
    metadata["sha256"] = {name: sha256_file(vdir / name) for name in ARTIFACT_FILES}
    (vdir / METADATA_FILE).write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")

    tmp = root / (LATEST_FILE + ".tmp")
    tmp.write_text(version + "\n", encoding="utf-8")
    os.replace(tmp, root / LATEST_FILE)
    return vdir
