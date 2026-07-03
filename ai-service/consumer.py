import json
import pickle
import requests
import numpy as np
from confluent_kafka import Consumer, KafkaError


def load_model():
    with open("model.pkl", "rb") as f:
        return pickle.load(f)


def start_consumer():
    model = load_model()
    print("AI Model loaded. Starting Kafka Consumer...")

    # Configure Kafka Consumer
    conf = {
        "bootstrap.servers": "localhost:19092",
        "group.id": "fluxgate-ai-workers",
        "auto.offset.reset": "earliest",
    }

    consumer = Consumer(conf)
    consumer.subscribe(["gateway.traffic.logs"])

    try:
        while True:
            # Poll for new messages every second
            msg = consumer.poll(1.0)

            if msg is None:
                continue

            if msg.error():
                if msg.error().code() == KafkaError._PARTITION_EOF:
                    continue
                else:
                    print(f"Kafka Error: {msg.error()}")
                    break

            # Parse JSON
            raw_data = msg.value().decode("utf-8")
            features = json.loads(raw_data)

            # Extract features
            req_size = features.get("requestByteBySize", 0)
            res_size = features.get("responseByteBySize", 0)
            latency = features.get("latencyMs", 0)
            print(json.dumps(features, indent=2))
            print(f"Request={req_size}, Response={res_size}, Latency={latency}")

            X_test = np.array([[req_size, res_size, latency]])
            score = model.decision_function(X_test)[0]
            # Predict
            prediction = model.predict(X_test)[0]
            print(f"Score={score:.4f}, Prediction={prediction}")

            if prediction == -1:
                requests.post('http://localhost:3000/internal/alerts', json={
                    "tenantId": features.get('tenantId'),
                    "alertType": "anomaly_detected",
                    "message": "Isolation Forest detected abnormal traffic",
                    "data": { "latencyMs": latency, "requestByteSize": req_size }
                })
            else:
                print(
                    f"Traffic Normal | "
                    f"Tenant: {features.get('tenantId')} | "
                    f"Latency: {latency}ms"
                )

    except KeyboardInterrupt:
        print("\nShutting down AI worker...")

    finally:
        consumer.close()


if __name__ == "__main__":
    start_consumer()