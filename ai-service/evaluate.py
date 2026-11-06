"""Honest sanity evaluation. Not accuracy: there is no labelled data.

    python evaluate.py [--version V] [--rows N] [--seed S]

1. Fraction of FRESH synthetic normal traffic (different seed from training) that gets flagged.
2. Whether a few hand-picked obvious outliers are flagged.
"""

from __future__ import annotations

import argparse

from model_store import load_model
from scoring import FEATURE_NAMES, Scorer, to_model_space
from settings import DEFAULT_MODEL_DIR
from synthetic import generate_traffic

OUTLIERS = {
    "GET, 30 s latency": (0, 3000, 30_000),
    "GET, 500 MB response": (0, 500_000_000, 80),
    "POST, 200 MB request body": (200_000_000, 400, 120),
    "GET with 5 KB request body (never seen in training)": (5000, 3000, 60),
    "GET, 1 ms latency, 0 byte response": (0, 0, 1),
    "typical GET (control, should be normal)": (0, 3000, 60),
    "typical POST (control, should be normal)": (800, 400, 120),
}


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--version")
    p.add_argument("--rows", type=int, default=50_000)
    p.add_argument("--seed", type=int, default=2024)
    p.add_argument("--model-dir", default=DEFAULT_MODEL_DIR)
    a = p.parse_args()

    loaded = load_model(a.model_dir, a.version)
    scorer = Scorer(loaded.model, loaded.baseline, loaded.version, loaded.metadata.get("featureMax"))
    print(f"model {loaded.version} (contamination={loaded.metadata['hyperparameters']['contamination']})")

    X = generate_traffic(a.rows, a.seed)
    flagged = (loaded.model.predict(to_model_space(X)) == -1).mean()
    print(f"fresh synthetic normal traffic: {a.rows} rows, seed {a.seed}: {flagged:.4%} flagged by the forest alone")
    guarded = sum(
        scorer.score(dict(zip(FEATURE_NAMES, map(float, row)))).is_anomaly for row in X[:5000]
    ) / 5000
    print(f"  forest + range guard on the first 5000 of those rows: {guarded:.4%} flagged")
    forest_only = []
    for name, (req, res, lat) in OUTLIERS.items():
        forest_only.append((name, loaded.model.predict(to_model_space([[req, res, lat]]))[0] == -1))
    print("forest alone on the hand-picked rows: " + "; ".join(f"{n}: {'flagged' if f else 'normal'}" for n, f in forest_only))

    for name, (req, res, lat) in OUTLIERS.items():
        r = scorer.score(dict(zip(FEATURE_NAMES, map(float, (req, res, lat)))))
        top = f", top feature {r.top_feature}" if r.is_anomaly else ""
        print(f"{'FLAGGED' if r.is_anomaly else 'normal ':8s} score={r.score:+.3f}  {name}{top}")


if __name__ == "__main__":
    main()
