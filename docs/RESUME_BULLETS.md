# Resume bullets

Each of these is implemented and can be checked. Pick three or four. Throughput is deliberately not a headline: the honest number is modest, measured on a laptop, and varied by a factor of three between runs.

## Backend

- Built a multi-tenant API gateway in TypeScript (Hono, Postgres, Redis, Kafka) with API key auth, per-tenant rate limiting, SSRF-guarded proxying and role-based access, with cross-tenant isolation proved by integration tests against real Postgres.
- Implemented token bucket, leaky bucket and sliding window limiters as atomic Redis Lua scripts, verified against real Redis to admit exactly 1,000 of 5,000 racing calls over 16 connections.
- Designed a request path that survives dependency failure: the rate limiter fails open with a metric and a response header, auth fails closed, and telemetry goes through two independent bounded buffers, so that an unreachable Kafka or Postgres cannot block a request. Tested with a real gateway process pointed at unreachable dependencies.
- Built reliable webhooks with a transactional outbox, HMAC signatures, encrypted secrets, exponential backoff, a dead state and a recovery sweeper, using a unique constraint to make at-least-once Kafka delivery produce a single alert.
- Audited an existing codebase and fixed privilege escalation, an open proxy through URL parsing, SSRF, credential forwarding and a false "fail-open" claim, each with a regression test.

## Data and machine learning

- Built a Python Kafka consumer that scores gateway traffic with an Isolation Forest and SHAP attribution, with manual offset commits, a real dead-letter topic, integrity-checked model versions, and signed alerts. Documented that the model is trained on synthetic data, and its known blind spots.

## Full stack

- Built a role-aware Next.js dashboard with real-time analytics (p50/p95/p99 latency, error rate, rate-limit hits), anomaly triage with SHAP explanations, and show-once secrets, tested end to end with Playwright and axe against the real gateway.

## Reliability and operations

- Added request and trace IDs across three processes and a message queue, using `AsyncLocalStorage` and W3C trace context, with an end-to-end test asserting that one ID joins the logs of each process.
- Replaced most of a mock-based test suite with real integration and end-to-end tests: a real gateway, Kafka and Python consumer process through to a delivered webhook, with coverage thresholds in CI and a one-command Docker demo.
- Replaced a published 10,000 req/s benchmark that only measured a health endpoint with a reproducible benchmark of the real request path, then used CPU profiling to show that there was no single bottleneck.

## Before you use these

- GitHub Actions has not run these workflows yet. Do not claim passing CI until it has.
- Do not quote user numbers, uptime or production use: this has only run locally.
- This was built with heavy AI assistance. Decide how you will describe that, and be able to explain each part without notes: `docs/INTERVIEW_TALKING_POINTS.md` is a place to start.
