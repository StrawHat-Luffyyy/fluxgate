# FluxGate: Edge-Native API Gateway & Traffic Intelligence Platform

[![CI/CD Status](https://github.com/StrawHat-Luffyyy/fluxgate/actions/workflows/ci.yaml/badge.svg)](https://github.com/StrawHat-Luffyyy/fluxgate/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

FluxGate is an enterprise-grade, edge-native API Gateway and Traffic Intelligence platform. Built for ultra-low latency routing, multi-tenant secure credentialing, and real-time AI-powered anomaly detection, FluxGate decouples the hot path of request proxying from downstream telemetry processing.

---

## 1. Executive Summary

### The Business Problem
Modern enterprises process billions of API calls daily. Traditional API gateway architectures fail when forced to perform real-time security checking, rate limiting, and behavioral analysis inline. Performing complex database queries or running machine learning algorithms on the request execution path degrades latency, limits maximum throughput, and compromises reliability. Furthermore, client-side token storage exposes critical credentials to cross-site scripting (XSS) attacks, while centralized rate limiters suffer from race conditions under high concurrency.

### The FluxGate Solution
FluxGate addresses these scaling bottlenecks using a **polyglot, event-driven microservice architecture**:
- **Zero-Buffering Proxy**: High-throughput routing built on Node.js/Hono using web streams.
- **Atomic Rate Limiting**: Redis-backed Lua scripts execute Sliding Window, Token Bucket, and Leaky Bucket algorithms in a single network round-trip, avoiding race conditions.
- **Decoupled Telemetry**: Telemetry collection is moved off the request-response thread using an asynchronous, fire-and-forget Kafka producer.
- **Asynchronous Traffic Intelligence**: A Python service consumes the Kafka stream, running unsupervised anomaly detection (Isolation Forest) with SHAP mathematical explanations, ensuring threat detection does not impact gateway latency.
- **Resilient Tenant Alerts**: BullMQ processes detected threat profiles and schedules webhook dispatches to affected tenants with exponential backoff.

---

## 2. System Architecture

```mermaid
graph TD
    Client[Client Browser / API Client] -->|HTTP / HTTPS| Gateway[Hono API Gateway]
    Gateway -->|1. Validate Auth & Rate Limit| Redis[(Redis Cache / Lua Scripts)]
    Gateway -->|2. Route Resolution| Pg[(PostgreSQL / Drizzle ORM)]
    Gateway -->|3. Zero-Buffer Pipe| Upstream[Upstream Target API]
    Gateway -->|4. Fire-and-Forget telemetry| Kafka[Kafka / Redpanda Broker]
    
    subgraph Traffic Intelligence Service
        Kafka -->|5. Stream logs| PythonAI[Python AI Consumer]
        PythonAI -->|6. Unsupervised Inference| IsoForest[Isolation Forest Model]
        PythonAI -->|7. Explain Anomaly| SHAP[SHAP Explainer]
    end
    
    PythonAI -->|8. Alert POST| Gateway
    Gateway -->|9. Enqueue Alert| BullMQ[BullMQ Webhook Queue]
    BullMQ -->|10. Retry with Backoff| Webhook[Tenant Webhook Endpoint]
    
    subgraph Dashboard
        DashboardClient[Next.js Client SPA] -->|Auth cookies / React Query| Gateway
    end
```

---

## 3. "Life of a Request" Execution Flow

Tracing a single HTTP request sequentially through the FluxGate ecosystem:

```
[Client] ➔ [Hono Gateway] ➔ [Redis] ➔ [Upstream API] ➔ [Kafka] ➔ [Python AI] ➔ [BullMQ] ➔ [Tenant Webhook]
```

1. **Ingress & Authentication Check**:
   - The Client initiates an HTTP request to `/gateway/:pathPrefix/*` with an `Authorization: Bearer <key>` header.
   - Hono interceptors check the local cache. If invalid or missing, it queries PostgreSQL via Drizzle ORM to verify the API key hash (`SHA-256`) and resolve tenant mapping.

2. **Atomic Rate Limiting Check**:
   - The gateway executes a Redis transaction running the configured strategy's Lua script (e.g., Token Bucket).
   - Redis evaluates the key `fluxgate:ratelimit:<tenantId>:<path>`. It returns `[allowed, remaining, retryAfter]`.
   - If `allowed == 0`, Hono returns `429 Too Many Requests` instantly.

3. **Dynamic Upstream Route Resolution**:
   - The gateway checks the dynamic route cache in Redis (`fluxgate:route:<tenantId>:<pathPrefix>`).
   - On a cache miss, it reads from PostgreSQL, caches the target URL with a 300-second TTL, constructs the target endpoint, and clones incoming headers.

4. **Zero-Buffer Streaming Proxy**:
   - Hono initiates an upstream HTTP fetch with `duplex: 'half'`. The request body is piped directly to the upstream server.
   - The upstream response is piped back to the client chunk-by-chunk using Web Streams, bypassing memory-buffered arrays to minimize memory footprint.

5. **Asynchronous Telemetry Dispatch**:
   - Once the response is sent, the gateway extracts metadata (`latencyMs`, `requestByteBySize`, `responseByteBySize`, `statusCode`, `clientIp`).
   - The gateway's Kafka producer publishes this event to `gateway.traffic.logs`. The active OpenTelemetry trace context is injected into the Kafka message headers to preserve the distributed transaction.

6. **Python AI Consumer Stream Parsing**:
   - The Python AI consumer polls the Kafka topic. It extracts the OTel trace context from headers, linking all downstream spans.
   - The metrics are processed into a vector: `[[requestByteSize, responseByteSize, latencyMs]]`.

7. **Inference & Explainability (SHAP)**:
   - The pre-trained `Isolation Forest` model predicts normalcy.
   - **If Normal**: The log is compiled and stored.
   - **If Anomaly (Prediction == -1)**: A `TreeExplainer` calculates SHAP values. The feature with the highest absolute SHAP value is identified as the anomaly driver.

8. **Alert Generation & Webhook Enqueueing**:
   - The Python service sends a POST request to `/internal/alerts`.
   - The internal router pushes a `send-webhook` job to BullMQ containing the anomaly score, driver, and context.

9. **Webhook Delivery with Backoff**:
   - A BullMQ worker retrieves the job, constructs the webhook payload, and POSTs it to the tenant's configured destination.
   - If the endpoint fails (non-2xx), the worker retries the job up to 5 times using an exponential backoff strategy (`delay = attempts * 1000ms`).

---

## 4. Key Architectural Trade-Offs

| Decision Axis | Choice | Alternative Considered | Engineering Rationale |
| :--- | :--- | :--- | :--- |
| **Payload Handling** | **Streaming** | Buffering | Buffering loads the entire request body into RAM before forwarding. Under high concurrency or during file uploads, memory consumption scales linearly with payload size, risking Out-Of-Memory (OOM) crashes. Streaming routes chunks directly to the socket, maintaining near-zero memory utilization. |
| **State Operations** | **Redis Lua** | Node.js Logic | Evaluating rate limits inside Node.js requires multiple round-trips (Get limit, increment, check, write). Under load, race conditions (time-of-check to time-of-use) allow clients to bypass limits. Lua scripts run atomically inside Redis's single-threaded core, preventing race conditions. |
| **Token Storage** | **HttpOnly Cookies** | LocalStorage | LocalStorage is vulnerable to Cross-Site Scripting (XSS) attacks; any injected script can read the token. HttpOnly cookies are inaccessible to JavaScript, protecting sessions from credential theft. Cross-site Request Forgery (CSRF) is mitigated by enforcing `SameSite: Strict`. |
| **Telemetry Pipe** | **Kafka / Redpanda** | Direct Database Logging | Writing traffic logs directly to PostgreSQL or Sentry synchronously during the request cycle blocks the event loop. Kafka decouples ingestion from storage, allowing the gateway to handle high-throughput traffic without wait states. |

---

## 5. Directory Layout

```
fluxgate/
├── ai-service/             # Python AI Anomaly Detection service (Isolation Forest & SHAP)
├── drizzle/                # Database migrations and schema settings
├── frontend/               # Next.js SPA dashboard
│   ├── app/
│   │   ├── components/     # Componentized UI (StatCards, Charts, Skeletons)
│   │   ├── hooks/          # React Query query/mutation abstractions
│   │   └── lib/            # Centralized API fetch wrapper with cookie forwarding
├── src/                    # Node.js/Hono Gateway Core
│   ├── config/             # Zod environment schemas
│   ├── db/                 # Drizzle client configuration
│   ├── kafka/              # Kafka producer client
│   ├── middleware/         # Centralized error handler, auth, rate limiters, metrics
│   ├── monitoring/         # OpenTelemetry, Sentry, and Prometheus registries
│   ├── queue/              # BullMQ queue & worker configuration
│   ├── redis/              # Redis client & Lua rate-limiting scripts
│   ├── routes/             # Thin controllers forwarding to services
│   └── services/           # Decoupled business logic controllers
├── Dockerfile              # Multi-stage optimized Node.js Alpine build
└── docker-compose.yml      # Infrastructure configurations (Postgres, Redis, Redpanda)
```

---

## 6. Local Development Setup

### Prerequisites
- Node.js v22+
- Python 3.12+
- Docker & Docker Compose

### 1. Provision Infrastructure
Start Redis, Postgres, and Redpanda (Kafka):
```bash
docker compose up -d
```

### 2. Configure Environment Variables
Create a `.env` file in the root directory:
```env
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://fluxgate:fluxgate@localhost:5432/fluxgate
REDIS_URL=redis://localhost:6379
JWT_SECRET=super-secret-jwt-key-minimum-32-characters
KAFKA_BROKER=localhost:19092
OTLP_ENDPOINT=http://localhost:4318/v1/traces
```

### 3. Initialize the Database
Run Drizzle migrations to configure schemas:
```bash
pnpm install
pnpm db:push
```

### 4. Start the Gateway Core (Hono)
```bash
pnpm dev
```

### 5. Setup and Run the Python AI Service
Create a virtual environment and install dependencies:
```bash
cd ai-service
python -m venv venv
source venv/bin/activate  # On Windows use `venv\Scripts\activate`
pip install -r requirements.txt
```

Train the initial baseline Isolation Forest model:
```bash
python train.py
```

Start the Kafka consumer:
```bash
python consumer.py
```

### 6. Run the Frontend Dashboard (Next.js)
```bash
cd ../frontend
npm install
npm run dev
```
Open [http://localhost:3001](http://localhost:3001) in your browser.
