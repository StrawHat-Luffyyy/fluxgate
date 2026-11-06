"""Train an Isolation Forest and write a versioned artifact set under models/<version>/.

    python train.py                        # synthetic traffic (see synthetic.py, NOT real data)
    python train.py --csv traffic.csv      # columns: request_byte_size,response_byte_size,latency_ms
    python train.py --version v3-custom
"""

from __future__ import annotations

import argparse
import csv
import logging
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import sklearn
from sklearn.ensemble import IsolationForest

from jsonlog import configure_logging
from model_store import write_version
from scoring import FEATURE_NAMES, to_model_space
from settings import DEFAULT_MODEL_DIR
from synthetic import generate_traffic

logger = logging.getLogger("fluxgate.train")

CSV_COLUMNS = ["request_byte_size", "response_byte_size", "latency_ms"]
MIN_ROWS = 100
BASELINE_ROWS = 200


def load_csv(path: str) -> np.ndarray:
    rows = []
    skipped = 0
    with open(path, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        missing = [c for c in CSV_COLUMNS if c not in (reader.fieldnames or [])]
        if missing:
            raise SystemExit(f"CSV is missing required columns: {missing}")
        for rec in reader:
            try:
                row = [float(rec[c]) for c in CSV_COLUMNS]
            except (TypeError, ValueError):
                skipped += 1
                continue
            if not all(np.isfinite(row)) or min(row) < 0:
                skipped += 1
                continue
            rows.append(row)
    if skipped:
        logger.warning("skipped unusable CSV rows", extra={"skipped": skipped})
    if len(rows) < MIN_ROWS:
        raise SystemExit(f"need at least {MIN_ROWS} usable rows, got {len(rows)}")
    return np.array(rows, dtype=float)


def next_version(model_dir: str, source: str) -> str:
    numbers = [
        int(m.group(1))
        for p in Path(model_dir).glob("v*")
        if p.is_dir() and (m := re.match(r"v(\d+)", p.name))
    ]
    n = max(numbers + [1]) + 1  # v1 was the legacy pickle model
    return f"v{n}-{source}-{datetime.now(timezone.utc):%Y%m%d}"


def train(X: np.ndarray, source: str, version: str, model_dir: str, contamination: float, seed: int) -> Path:
    params = {"n_estimators": 200, "contamination": contamination, "random_state": seed}
    model = IsolationForest(**params)
    model.fit(to_model_space(X))

    rng = np.random.default_rng(seed)
    idx = rng.choice(len(X), size=min(BASELINE_ROWS, len(X)), replace=False)
    baseline = X[idx]  # raw units; the scorer applies log1p when loading

    import shap

    metadata = {
        "createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "sklearnVersion": sklearn.__version__,
        "numpyVersion": np.__version__,
        "shapVersion": shap.__version__,
        "featureNames": FEATURE_NAMES,
        "featureTransform": "log1p",
        "hyperparameters": params,
        "trainingSource": source,
        "trainingRows": int(len(X)),
        "baselineRows": int(len(baseline)),
        "featureMax": {n: float(v) for n, v in zip(FEATURE_NAMES, X.max(axis=0))},
    }
    return write_version(model_dir, version, model, baseline, metadata)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--csv", help="exported real traffic; default is synthetic data")
    parser.add_argument("--version", help="version label, e.g. v3-custom (default: auto)")
    parser.add_argument("--rows", type=int, default=20000, help="synthetic rows (default 20000)")
    parser.add_argument("--contamination", type=float, default=0.01)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--model-dir", default=DEFAULT_MODEL_DIR)
    args = parser.parse_args(argv)

    configure_logging("INFO")
    if args.csv:
        X, source = load_csv(args.csv), args.csv
        label = "csv"
    else:
        X, source = generate_traffic(args.rows, args.seed), "synthetic"
        label = "synthetic"
    version = args.version or next_version(args.model_dir, label)
    vdir = train(X, source, version, args.model_dir, args.contamination, args.seed)
    logger.info("model written", extra={"version": version, "path": str(vdir), "rows": len(X), "source": source})
    return 0


if __name__ == "__main__":
    sys.exit(main())
