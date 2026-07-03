import pickle
import numpy as np
from sklearn.ensemble import IsolationForest

def train_baseline_model():
    print("Training baseline Isolation Forest model...")

    # Generate synthetic "normal" baseline data to bootstrap the model.
    # Features: [requestByteSize, responseByteSize, latencyMs]
    # Normal traffic: small requests, 1KB-5KB responses, 50ms-200ms latency
    np.random.seed(42)
    normal_req_sizes = np.random.normal(60, 20, 1000)
    normal_res_sizes = np.random.normal(70, 20, 1000)
    normal_latencies = np.random.normal(600, 150, 1000)

    # Combine into a 2D array (1000 rows, 3 columns)
    X_train = np.column_stack((normal_req_sizes, normal_res_sizes, normal_latencies))

    # Initialize Isolation Forest. 
    # contamination=0.01 means we expect ~1% of traffic to be anomalous.
    model = IsolationForest(n_estimators=100, contamination=0.01, random_state=42)
    model.fit(X_train)

    # Save the trained model to disk so the consumer can load it
    with open('model.pkl', 'wb') as f:
        pickle.dump(model, f)

    print("Baseline model saved to model.pkl")

if __name__ == "__main__":
    train_baseline_model()