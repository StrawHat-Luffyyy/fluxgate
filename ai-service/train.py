import pickle
import numpy as np
from sklearn.ensemble import IsolationForest

def train_model(data=None):
    print("Training Isolation Forest model...")
    

    if data is None:
        np.random.seed(42)
        normal_req_sizes = np.random.normal(500, 100, 1000)
        normal_res_sizes = np.random.normal(2500, 500, 1000)
        normal_latencies = np.random.normal(100, 20, 1000)

        # Combine into a 2D array (1000 rows, 3 columns)
        X_train = np.column_stack((normal_req_sizes, normal_res_sizes, normal_latencies))
    else:
        X_train = data


    # Initialize Isolation Forest. 
    # contamination=0.01 means we expect ~1% of traffic to be anomalous.
    model = IsolationForest(n_estimators=100, contamination=0.01, random_state=42)
    model.fit(X_train)

    # Save the new model to disk. 
    # Note: We overwrite model.pkl. The consumer will reload it dynamically.
    with open('model.pkl' , 'wb') as f:
        pickle.dump(model, f)

    print("Model trained and saved to model.pkl.")

    # Return the training data so we can build our SHAP baseline explainer
    with open('baseline_data.pkl', 'wb') as f:
        pickle.dump(X_train, f)


if __name__ == "__main__":
    train_model()