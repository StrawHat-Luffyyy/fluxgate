# FluxGate: AI-Powered API Gateway

## Project Vision

FluxGate is a high-throughput, AI-powered API Gateway and Traffic Intelligence Platform designed for the edge. It acts as the absolute front door for modern infrastructure, providing secure, multi-tenant API management, intelligent rate limiting, and real-time anomaly detection using machine learning, built entirely on web standards.

## Project Goals

- **Performance & Scalability:** Handle high-volume traffic with low latency using an edge-native framework (Hono) and robust connection pooling.
- **Multi-Tenancy:** Securely isolate traffic, rate limits, and analytics for multiple tenants (customers/users) using the gateway.
- **Traffic Intelligence:** Go beyond simple routing by using AI (Isolation Forest) to detect anomalous traffic patterns and malicious requests in real time.
- **Production-Readiness:** Implement industry-standard observability (distributed tracing, structured logging), strict validation, and automated CI/CD pipelines.
- **Portability:** Decouple from Node.js-specific APIs to ensure the gateway can be deployed to edge networks (e.g., Cloudflare Workers) or traditional containerized environments.

## Architecture

FluxGate operates on a distributed micro-architecture model:

1. **Edge Router (Hono):** Intercepts standard Web Fetch API requests.
2. **Middleware Pipeline:** Handles Auth (JWT/API Keys), Environment Validation (Zod), and Tenant Context extraction.
3. **State Management:**
    - _Persistent State:_ PostgreSQL handles tenant data, routing rules, and billing tiers.
    - _Ephemeral/Fast State:_ Redis handles distributed rate limiting algorithms (Sliding Window, Token Bucket).
4. **Asynchronous Processing:** - _Audit Trail:_ Kafka/Redpanda streams request logs without blocking the main HTTP thread.
    - _Background Workers:_ BullMQ manages heavy lifting like sending webhooks or generating security reports.
5. **Traffic Intelligence Module:** A decoupled AI service (Python/ONNX) evaluates request embeddings to flag anomalies and provide SHAP explanations.

## Tech Stack

- **Backend Framework:** Node.js 22+, TypeScript, Hono
- **Database & ORM:** PostgreSQL (Neon), Drizzle ORM
- **Caching & Rate Limiting:** Redis (Upstash)
- **Message Queues & Streaming:** Kafka (Redpanda local), BullMQ
- **AI / ML:** ONNX Runtime, Python, scikit-learn, all-MiniLM-L6-v2, Isolation Forest
- **Authentication:** Better Auth, JWT, API Keys
- **Observability:** Prometheus, Grafana, OpenTelemetry, Sentry
- **Testing:** Vitest, Supertest, k6 (Load Testing)
- **DevOps & Tooling:** pnpm, Docker, Docker Compose, GitHub Actions
- **Deployment:** Railway, Neon, Upstash, Cloudflare, Nginx

## Folder Structure

```text
fluxgate/
├── .github/workflows/    # CI/CD pipelines
├── drizzle/              # Generated SQL migrations
├── src/
│   ├── config/           # Environment validation (Zod)
│   ├── db/               # DB connection, connection pooling, and schema
│   ├── middleware/       # Rate limiters, auth, logging interceptors
│   ├── routes/           # Domain-specific route handlers
│   ├── services/         # Core business logic (AI, Queue processing)
│   ├── utils/            # Shared utilities (crypto, structured logging)
│   ├── app.ts            # Hono application setup and global middleware
│   └── server.ts         # Server bindings and entry point
├── drizzle.config.ts     # Drizzle ORM configuration
├── docker-compose.yml    # Local infrastructure (Redis, Postgres, Kafka)
├── package.json          # pnpm workspace and dependencies
└── tsconfig.json         # Strict ES2022 module configuration
```
