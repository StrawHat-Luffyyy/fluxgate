# FluxGate Architecture

This document outlines the high-level architecture, technology choices, and request lifecycle for the FluxGate API Gateway.

## Core Request Lifecycle

1. **Edge Proxy:** Traffic hits **Cloudflare** for SSL termination and initial DDoS protection.
2. **Gateway Entry:** The request reaches the **Hono** router running on **Node.js**.
3. **Authentication & Identity:** Middleware validates the **JWT** or **API Key**, extracting the Tenant ID.
4. **Traffic Control:** The request hits the **Redis**-backed rate limiter (Sliding Window Log via Lua).
5. **Auditing (Async):** Request metadata is fired into **Kafka** for non-blocking audit logging.
6. **Intelligence (Async):** Request vectors are passed to the **ONNX Runtime** to detect anomalies using an **Isolation Forest** model.
7. **Routing:** Valid, within-limit requests are proxied to the upstream destination.

## State & Persistence

- **Database:** PostgreSQL (Neon Serverless)
- **ORM:** Drizzle ORM (Edge-compatible, low overhead)
- **Driver:** `postgres.js` (Robust connection pooling)

## Cache & Distributed State

- **Engine:** Redis (via `ioredis`)
- **Use Case:** Distributed Rate Limiting. Uses Lua scripting to guarantee atomicity and prevent race conditions across horizontal instances. Follows a Fail-Open philosophy.

## Reverse Proxy Layer

- **Engine:** Native Web Standard `fetch` API.
- **Payload Handling:** Zero-buffering `ReadableStream` piping.
- **Telemetry:** Captures byte throughput, execution latency, and tenant context per request.

---

## Infrastructure Breakdown

### 1. Gateway & Runtime

- **Framework:** **Hono**
  - _Why:_ Built on standard Web Fetch APIs, making the routing layer highly portable, ultra-fast, and natively ready for Edge deployments.
- **Runtime:** **Node.js**
  - _Why:_ Provides a robust ecosystem for our initial build, while our framework choice ensures we aren't permanently locked into Node-specific APIs.

### 2. State & Persistence

- **Database:** **PostgreSQL**
  - _Why:_ Offers the relational integrity required for managing complex multi-tenant B2B architectures, API key metadata, and routing rules.
- **ORM:** **Drizzle ORM**
  - _Why:_ Edge-compatible, lightweight, and uses a SQL-like syntax that prevents over-abstraction and N+1 query problems.
- **Cache & Fast State:** **Redis**
  - _Why:_ Essential for sub-millisecond data retrieval. Used exclusively for distributed state management, specifically atomicity in rate-limiting via Lua scripting.

### 3. Asynchronous Processing

- **Streaming:** **Kafka**
  - _Why:_ Acts as a high-throughput, fault-tolerant ingestion pipe for raw access logs and analytics streams without blocking the main HTTP thread.
- **Queue / Workers:** **BullMQ**
  - _Why:_ Handles heavy, delayed, or scheduled background jobs (e.g., sending webhooks, generating weekly security reports, and managing database rollups).

  ## Background Workers

- **Engine:** BullMQ (Redis-backed)
- **Use Case:** Delivering external webhooks and processing heavy background tasks.
- **Resilience:** Implements exponential backoff to protect third-party systems and ensure eventual consistency.

  ## Auditing & Event Streaming

- **Engine:** Kafka (Redpanda for local orchestration)
- **Pattern:** Asynchronous "Fire and Forget" publishing from the critical proxy path.
- **Partitioning:** Messages are keyed by `tenantId` to guarantee strict chronological ordering per customer.

### 4. Traffic Intelligence (AI)

- **Inference Engine:** **ONNX Runtime**
  - _Why:_ Allows us to run pre-trained machine learning models directly within our backend infrastructure with extreme performance.
- **Anomaly Detection:** **Isolation Forest**
  - _Why:_ An unsupervised learning algorithm optimized for isolating anomalies (malicious traffic, unusual endpoint access) from normal request patterns.

  ## Traffic Intelligence (AI)

- **Language:** Python
- **Model:** Isolation Forest (`scikit-learn`)
- **Architecture:** Unsupervised anomaly detection running as a decoupled microservice. Consumes telemetry from Kafka, ensuring inference overhead never impacts Gateway proxy latency.

### 5. Security & Identity

- **Authentication:** **JWT (JSON Web Tokens) & API Keys**
  - _Why:_ JWTs are used for internal admin dashboard access, while cryptographically hashed API Keys are used for external tenant machine-to-machine routing.

  ## Security & Identity

- **API Keys:** Machine-to-machine authentication using 48-character high-entropy hex strings.
- **Storage:** Keys are hashed via SHA-256 prior to database insertion. Raw keys are never stored.
- **Context Injection:** The Hono router injects validated `tenantId` parameters into downstream request scopes via `c.set()`.

### 6. Observability

- **Tracing & Metrics:** **OpenTelemetry**
  - _Why:_ Provides a vendor-agnostic standard for distributed tracing across the micro-architecture.
- **Storage & Visualization:** **Prometheus & Grafana**
  - _Why:_ Prometheus scrapes the system metrics, while Grafana provides real-time visual dashboards for Gateway health, rate-limit drops, and latency percentiles.

  ## Observability

- **Metrics Engine:** Prometheus (`prom-client`) exposing `/metrics`.
- **Measurement Strategy:** Pull-model architecture capturing HTTP status codes, route throughput, and latency histograms to calculate P95/P99 percentiles.
- **Load Testing:** `k6` utilized for concurrent virtual user simulation and bottleneck identification.

### 7. Deployment & Tooling

- **Monorepo Management:** **pnpm Workspaces**
  - _Why:_ Enforces strict dependency resolution and optimizes disk space, crucial for managing multiple internal packages (core, UI, AI workers).
- **Containerization:** **Docker**
  - _Why:_ Ensures absolute environmental parity between local development and production.
- **Hosting:** **Railway**
  - _Why:_ Provides scalable, zero-downtime deployments for our Dockerized containers.
- **Edge Network:** **Cloudflare**
  - _Why:_ Acts as the absolute perimeter defense, caching, and DNS layer.

## Deployment & DevOps

- **Containerization:** Multi-stage Docker builds (Alpine Linux) ensuring small image sizes and stripped dev-dependencies.
- **CI/CD:** GitHub Actions pipeline automating strict type-checking (`tsc --noEmit`), dependency caching, and build verification on all pushes.
- **Methodology:** Fully adheres to the 12-Factor App methodology (Stateless, Configuration via Environment, Logs as Event Streams).
