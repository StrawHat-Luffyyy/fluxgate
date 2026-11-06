# FluxGate AI service

Consumes per-request telemetry from Kafka (`gateway.traffic.logs`), scores it with an Isolation
Forest, explains anomalies with SHAP and POSTs HMAC-signed alerts to the gateway
(`/internal/alerts`).

## Run

```bash
cd ai-service
python -m venv --system-site-packages .venv      # or a plain venv + pip install -r requirements.txt
.venv/Scripts/python -m pip install -r requirements-dev.txt   # Windows; use .venv/bin/python elsewhere

.venv/Scripts/python train.py                    # writes models/<version>/ and updates models/LATEST
export INTERNAL_ALERT_SECRET=...                 # required; same value as the gateway
.venv/Scripts/python consumer.py                 # health on http://localhost:8090/health
.venv/Scripts/python -m pytest --cov=.           # tests (no Kafka needed)
.venv/Scripts/python evaluate.py                 # sanity evaluation (see below)
```

Configuration is by environment variable, see `.env.example`: `KAFKA_BROKERS`, `KAFKA_TOPIC`,
`KAFKA_DLQ_TOPIC`, `KAFKA_GROUP_ID`, `ALERT_ENDPOINT`, `INTERNAL_ALERT_SECRET` (required, startup
fails without it), `MODEL_DIR`, `MODEL_VERSION` (default: contents of `models/LATEST`),
`HEALTH_PORT`, `LOG_LEVEL`.

## Behaviour

* **At-least-once.** Auto-commit is off; the offset is committed synchronously after each message
  is handled.
  * Normal, anomalous-and-alerted, and rate-limited (`rateLimited: true`, never scored) messages: commit.
  * Malformed JSON, schema-invalid messages, and alerts permanently rejected by the gateway
    (4xx other than 408/429): the original bytes go to the `KAFKA_DLQ_TOPIC` Kafka topic with
    `x-dlq-error` and `x-dlq-source` headers, then commit.
  * Alert delivery still failing after retries (5xx, 408, 429, connection errors; exponential
    backoff with jitter, 5 attempts) or a DLQ write failure: **not committed**, the consumer seeks
    back and reprocesses the message. The gateway deduplicates on `tenantId + requestId`, so
    redelivery is safe. `/health` reports `degraded` while alerts are failing.
* Retriable Kafka errors are logged and polling continues (librdkafka reconnects). Fatal errors
  exit non-zero. SIGINT/SIGTERM (and SIGBREAK on Windows) shut down cleanly: consumer closed,
  producer flushed. Note: on Windows SIGTERM is only delivered through `os.kill`; Ctrl+Break /
  Ctrl+C are the practical triggers.
* Alerts are signed: `X-FluxGate-Signature: t=<unix s>,v1=<hmac_sha256(secret, "<t>." + body)>`
  over the exact bytes sent. `traceparent`/`tracestate` from the Kafka headers are forwarded and
  `traceId` is logged. Logs are JSON, one object per line.
* `GET /health` returns `{status, modelVersion, kafkaConnected, lastMessageAt, processed, anomalies,
  dlq, alertFailures}`; HTTP 503 when the loop has not started or hit a fatal error.
  `kafkaConnected` is a best-effort signal: it turns false on a Kafka error event and back to true
  after 30 s without one.

## Model, data and what the numbers mean

**The default training data is synthetic.** `synthetic.py` draws 20,000 rows from a hand-designed
mixture that imitates a generic JSON API:

* 70% GET-like: `requestByteSize = 0`, response bytes log-normal (median 3000 B, sigma 1.0), latency log-normal (median 60 ms, sigma 0.5)
* 30% POST-like: request bytes log-normal (median 800 B, sigma 0.8), response log-normal (median 400 B, sigma 0.7), latency log-normal (median 120 ms, sigma 0.5)

Every parameter is an assumption, not a measurement of any real system. (The previous version
used ~500 request bytes on every request, so every real GET looked anomalous.) Features go through
`log1p` before the forest because the raw values are heavy-tailed. SHAP is computed in that
`log1p` space and keyed by the original feature names; `topFeatureValue` and `features` in the
alert are raw units. A SHAP value is therefore "contribution in log space", not bytes or ms.

**Contamination** (`0.01`) is the share of the training data the forest is told to treat as
outliers; it sets the decision threshold. The expected flag rate on normal traffic is thus a
chosen parameter, not a measured accuracy.

**No labelled dataset exists, so precision and recall are NOT measured.** Isolation Forest scores
saturate beyond the training range, so `scoring.py` adds a range guard: any feature above 10x its
training maximum (stored as `featureMax` in `metadata.json`) is flagged even if the forest score
is unremarkable. That 10x is a chosen constant too.

### Versioned artifacts

`models/<version>/model.joblib`, `baseline.joblib` (200 raw rows for SHAP) and `metadata.json`
(version, createdAt, sklearn/numpy/shap versions, feature names, hyperparameters, training source,
row count, sha256 of each artifact). Versions are immutable; `models/LATEST` names the newest.
joblib/pickle executes code on load, so `model_store` verifies the sha256 and refuses a mismatch;
still only deploy artifacts you trained yourself.

### Retrain on real traffic

Export from Postgres (table `request_logs`), then train:

```sql
\copy (SELECT request_byte_size, response_byte_size, latency_ms FROM request_logs WHERE rate_limited = false AND created_at > now() - interval '14 days') TO 'traffic.csv' CSV HEADER
```

```bash
python train.py --csv traffic.csv --version v3-real-20261201   # --version optional
```

Adjust the `WHERE` to your schema (drop the `rate_limited` filter if the column does not exist).
The CSV must have the header `request_byte_size,response_byte_size,latency_ms` and at least 100
usable rows. Then restart the consumer (or set `MODEL_VERSION`). Real traffic contains anomalies
already; contamination then means what it says.

### Evaluation (sanity check on synthetic data only)

Reproduce with `python evaluate.py` (model `v2-synthetic-20261106`, fresh synthetic rows with seed
2024, i.e. not the training sample):

* Fraction of fresh synthetic normal traffic flagged: **0.984%** (50,000 rows, forest alone);
  1.04% for forest + range guard on the first 5,000 of those rows. This simply reproduces the
  chosen contamination of 1%, it says nothing about real traffic.
* Hand-picked rows: GET with 30 s latency, GET with 500 MB response, POST with 200 MB request
  and GET with 1 ms latency and 0-byte response are all flagged; typical GET and POST controls
  are not. A GET carrying a 5 KB request body is **not** flagged (it is only mildly unusual).
* The forest alone does **not** flag the 30 s latency, 500 MB response or 200 MB request rows;
  they are caught by the range guard. This is why the guard exists.

These are checks that the pipeline behaves sensibly on cases chosen by hand, not detection
performance.
