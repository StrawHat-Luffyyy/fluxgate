"""
FluxGate AI Model Training Script

Trains an Isolation Forest anomaly detection model on synthetic
normal traffic data and saves both the model and SHAP baseline data.
"""

import logging
import pickle

import numpy as np
import numpy.typing as npt
from sklearn.ensemble import IsolationForest

logging.basicConfig(
    level=logging.INFO,
    format='{"timestamp":"%(asctime)s","level":"%(levelname)s","module":"%(name)s","message":"%(message)s"}',
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("fluxgate-ai-trainer")


def train_model(data: npt.NDArray[np.float64] | None = None) -> None:
    """
    Trains an Isolation Forest model on the provided data or synthetic normal traffic.

    Args:
        data: Optional pre-collected training data with shape (n_samples, 3).
              Columns: [requestByteSize, responseByteSize, latencyMs].
              If None, synthetic normal distributions are generated.
    """
    logger.info("Training Isolation Forest model...")

    if data is None:
        np.random.seed(42)
        normal_req_sizes: npt.NDArray[np.float64] = np.random.normal(500, 100, 1000)
        normal_res_sizes: npt.NDArray[np.float64] = np.random.normal(2500, 500, 1000)
        normal_latencies: npt.NDArray[np.float64] = np.random.normal(100, 20, 1000)

        # Combine into a 2D array (1000 rows, 3 columns)
        X_train: npt.NDArray[np.float64] = np.column_stack(
            (normal_req_sizes, normal_res_sizes, normal_latencies)
        )
    else:
        X_train = data

    # Initialize Isolation Forest.
    # contamination=0.01 means we expect ~1% of traffic to be anomalous.
    model = IsolationForest(n_estimators=100, contamination=0.01, random_state=42)
    model.fit(X_train)

    # Save the new model to disk.
    # Note: We overwrite model.pkl. The consumer will reload it dynamically.
    with open("model.pkl", "wb") as f:
        pickle.dump(model, f)

    logger.info("Model trained and saved to model.pkl")

    # Return the training data so we can build our SHAP baseline explainer
    with open("baseline_data.pkl", "wb") as f:
        pickle.dump(X_train, f)

    logger.info("Baseline data saved to baseline_data.pkl")


if __name__ == "__main__":
    train_model()