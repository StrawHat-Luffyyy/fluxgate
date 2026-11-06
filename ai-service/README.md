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
    (400, 422, or 404 with `TENANT_NOT_FOUND`): the original bytes go to the `KAFKA_DLQ_TOPIC` Kafka topic with
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

* 50% GET-like: `requestByteSize = 0`, response bytes log-normal (median 3000 B, sigma 1.0), latency log-normal (median 60 ms, sigma 0.6)
* 20% POST-like: request bytes log-normal (median 800 B, sigma 0.8), response log-normal (median 400 B, sigma 0.7), latency median 120 ms, sigma 0.6
* 15% empty responses (204/304-like): 0 response bytes, latency median 30 ms, sigma 1.0 (wide, fast)
* 15% small error bodies (4xx/5xx-like): response median 150 B, sigma 0.6, latency median 40 ms, sigma 1.0
* 30% of the empty and error rows also carry a small request body (median 300 B)

Every parameter is an assumption, not a measurement of any real system. (The first version used ~500 request bytes on every request, so every real GET looked
anomalous; the second lacked empty and fast responses, so 204/304 responses were flagged.) Features go through
`log1p` before the forest because the raw values are heavy-tailed. SHAP takes those `log1p`
features as input and is keyed by the original feature names; `topFeatureValue` and `features` in
the alert are raw units. A SHAP value is in isolation-tree path length, not bytes or ms: the splits
a feature added to or removed from the average path. Negative means easier to isolate, so more
anomalous; positive means more normal.

**Contamination** (`0.01`) is the share of the training data the forest is told to treat as
outliers; it sets the decision threshold. The expected flag rate on normal traffic is thus a
chosen parameter, not a measured accuracy.

**No labelled dataset exists, so precision and recall are NOT measured.**

**Range guard.** Isolation Forest scores saturate beyond the training range, so `scoring.py` adds a
range guard: a feature above `RANGE_GUARD_MULTIPLIER` (default 10, `0` disables) times its
training maximum is flagged even if the forest does not flag it. Such alerts carry
`detector: "range_guard"` and a message saying which limit was exceeded; alerts the forest raised
carry `detector: "forest"`. The maxima (`featureMax` in `metadata.json`) come from the
**synthetic** training data until the model is retrained on real traffic, so the limits are
currently (model `v3-synthetic-20261106`, 10x): requestByteSize 439,320 B, responseByteSize
1,192,380 B, latencyMs 14,480 ms. They are arbitrary until retrained on real traffic. A real
upload larger than 439 KB, for example, would trip the guard today.

**Messages not scored.** `rateLimited: true` and `upstreamCalled: false` (the gateway answered
itself) are skipped and committed; a missing `upstreamCalled` is treated as true. `latencyMs` is
time until upstream response headers.

**Alert delivery classes.** 2xx accepted. Permanent (DLQ + commit): 400, 422, and 404 with body
`{"error":"TENANT_NOT_FOUND"}`. Everything else (5xx, 408, 429, 401, 403, other 404s, connection
errors) is retried; if retries are exhausted the message is not committed and `/health` reports
`degraded`, so a rotated secret or wrong endpoint cannot silently drain alerts into the DLQ.
A failed `seek` (needed to re-read an uncommitted message) makes the process exit non-zero so it
restarts from the committed offset.

### Versioned artifacts

`models/<version>/model.joblib`, `baseline.joblib` (200 raw rows for SHAP) and `metadata.json`
(version, createdAt, sklearn/numpy/shap versions, feature names, hyperparameters, training source,
row count, sha256 of each artifact). Versions are immutable; `models/LATEST` names the newest.
joblib/pickle executes code on load, so `model_store` verifies the sha256 and refuses a mismatch;
still only deploy artifacts you trained yourself.

### Retrain on real traffic

Export from Postgres (table `request_logs`), then train:

```sql
\copy (SELECT request_bytes AS request_byte_size, response_bytes AS response_byte_size, latency_ms FROM request_logs WHERE upstream_called AND NOT rate_limited AND created_at > now() - interval '7 days') TO 'traffic.csv' CSV HEADER
```

```bash
python train.py --csv traffic.csv --version v4-real-20261201   # --version optional
```

The gateway keeps `request_logs` for 7 days, so that is the most this can export.
The CSV must have the header `request_byte_size,response_byte_size,latency_ms` and at least 100
usable rows. Then restart the consumer (or set `MODEL_VERSION`). Real traffic contains anomalies
already; contamination then means what it says.

### Evaluation (sanity check on synthetic data only)

Reproduce with `python evaluate.py` (model `v3-synthetic-20261106`, fresh synthetic rows with seed
2024, i.e. not the training sample):

* Fraction of fresh synthetic normal traffic flagged: **1.134%** (50,000 rows, forest alone);
  1.12% for forest + range guard on the first 5,000 of those rows. This reproduces the chosen
  contamination of 1%, it says nothing about real traffic.
* Not flagged (as intended): 204 with 0 B at 15 ms, 204 at 150 ms, 304 at 20 ms, a 150 B error
  body at 25 ms, and the typical GET and POST controls.
* Flagged, all by the range guard rather than the forest: GET with 30 s latency, GET with
  500 MB response, POST with 200 MB request body. The forest alone does not flag them.
* Not flagged: a GET carrying a 5 KB request body (only mildly unusual).

These are checks that the pipeline behaves sensibly on cases chosen by hand, not detection
performance.

## Known limitations of the shipped model

- **Slow requests below the guard are not flagged.** For an ordinary GET, latencies of 2 s, 5 s, 10 s and 14 s score as normal: the forest saturates past its training range, and the range guard only starts at 14.48 s. `tests/test_shipped_model.py` pins this behaviour, so fixing it will fail that test and prompt an update here.
- **Synthetic baseline.** The model learned a generated distribution, not your traffic. Retrain on real traffic before relying on it.
- **No per-tenant model.** One model scores all tenants, so a tenant whose normal traffic differs from the training data will see more alerts.
- **No alert throttling.** Each flagged request creates one anomaly row and one webhook delivery per endpoint. At the 1% contamination this model was trained with, a busy tenant gets many alerts.
