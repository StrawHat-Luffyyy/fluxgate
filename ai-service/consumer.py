import json
import pickel
import numpy as np
from confluent_kafka import Consumer, KafkaError

def load_model():
    with open('model.pkl' , 'rb') as f:
        return pickle.load(f)

def start_consumer():
  model = load_model()
  print("AI Model loaded. Starting Kafka Consumer...")

  # Configure Kafka Consumer
  conf = {
    'bootstrap.servers': 'localhost:19092',
    'group.id': 'fluxgate-ai-workers',
    'auto.offset.reset': 'earliest' # Start from the beginning if no offset exists
  }

  consumer = Consumer(conf)
  consumer.subscribe(['gateway.traffic.logs'])

  try:
    while True:
      # Poll for new messages every 1.0 second
      msg = consumer.poll(1.0)

      if msg is None:
        continue
      if msg.error():
        if msg.error().code() == KafkaError._PARTITION_EOF:
          # End of partition event
          continue
        else:
          # Error
          print(f"Kafka Error: {msg.error()}")
          break

      # Parse the JSON payload from Node.js
      raw_data = msg.value().decode('utf-8')
      features = json.loads(raw_data)

      # Extract the exact 3 features the model was trained on
      req_size = features.get('requestByteSize' , 0)
      res_size = features.get('responseByteSize' , 0)
      latency = features.get('latencyMs' , 0)

      # Reshape for scikit-learn (1 row, 3 columns)
      X_test = np.array([[req_size, res_size, latency]])

      # Predict: 1 means Normal, -1 means Anomaly
    prediction = model.predict(X_test)[0]

    if prediction == -1:
        print(f"ANOMALY DETECTED! Tenant: {features.get('tenantId')} | Latency: {latency}ms | Res: {res_size} bytes")
    else:
        print(f"Traffic Normal | Tenant: {features.get('tenantId')} | Latency: {latency}ms")

except KeyboardInterrupt:
    print("\n Shutting down AI worker...")
finally:
    consumer.close()

if __name__ == "__main__":
    start_consumer()