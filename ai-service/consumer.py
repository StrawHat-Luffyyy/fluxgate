import json
import pickle
import requests
import numpy as np
import shap
from confluent_kafka import Consumer, KafkaError


def load_assets():
    with open('model.pkl', 'rb') as f:
        model = pickle.load(f)
    with open('baseline_data.pkl' , 'rb') as f:
        baseline_data = pickle.load(f)
    return model , baseline_data

def generate_explanation(explainer , X_test, features_dict):
    """Calculates SHAP  values and return a human-readable explanation."""
    shap_values = explainer.shap_values(X_test)

    features_names = ['requestByteSize' , 'responseByteSize' , 'latencyMs']
    contributions = np.abs(shap_values[0])

    max_idx = np.argmax(contributions)
    top_feature = features_names[max_idx]

    return f"Anomaly driven primarily by {top_feature} (Value: {list(features_dict.values())[max_idx]})."

def start_consumer():
    model , baseline_data = load_assets()

    # Initialize the SHAP TreeExplainer using our baseline training data
    print("Initializing SHAP Explainer...")
    explainer = shap.TreeExplainer(model , baseline_data)

    print("AI Model loaded. Starting Kafka Consumer...")

    conf = {
        'bootstrap.servers': 'localhost:19092',
        'group.id': 'fluxgate-ai-workers',
        'auto.offset.reset': 'earliest'
    }
    consumer = Consumer(conf)
    consumer.subscribe(['gateway.traffic.logs'])

    try:
        while True:
            msg = consumer.poll(timeout = 1.0)
            if msg is None:
                continue
            if msg.error() and msg.error().code() != KafkaError._PARTITION_EOF:
                print(f" Kafka Error : {msg.error()}")
                break
            if msg.error():
                continue

            raw_data = msg.value().decode('utf-8')
            features = json.loads(raw_data)

            req_size = features.get('requestByteSize' , 0)
            res_size = features.get('responseByteSize' , 0)
            latency = features.get('latencyMs' , 0)

            X_test = np.array([[req_size , res_size , latency]])
            prediction = model.predict((X_test))[0]

            if prediction == -1:
                explanation = generate_explanation(explainer, X_test , {'req': req_size, 'res': res_size, 'lat': latency})
                print(f"ANOMALY! {explanation}")

                try:
                    requests.post('http://localhost:3000/internal/alerts' , json={
                        "tenantId": features.get("tenantId"),
                        "alertType": "anomaly_detected",
                        "message": explanation,
                        "data": {"latencyMs": latency, "requestByteSize": req_size}
                    } , timeout=2)
                except Exception as e:
                    print(f"Failed to queue webhook: {e}")
            else:
                print(f"Traffic Normal | Tenant: {features.get('tenantId')}")

    except KeyboardInterrupt:
        print("\n Shutting down AI worker...")
    finally:
        consumer.close()
    
if __name__ == "__main__":
    start_consumer()
