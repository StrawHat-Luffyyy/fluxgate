# FluxGate improvement plan

Goal: a project that can be defended line by line. Every claim in the README must be traceable to code, a test, or a reproducible run.

Status key: `[x]` done and verified, `[~]` done with a stated limitation, `[ ]` not done yet, `[-]` deliberately not done (reason given).

## Defects found during the audit that were not in the original brief

| Defect | Location | Impact |
| --- | --- | --- |
| `POST /auth/register` accepts `tenantId` and `role` from the body | `auth.service.ts` | Anyone can become admin of any tenant |
| `POST /tenants` has no auth | `routes/tenants.ts` | Unauthenticated tenant creation |
| Path `//host` after the prefix replaces the upstream host in `new URL()` | `proxy/handler.ts` | Open proxy / SSRF |
| Upstream target URLs are not SSRF-checked; `fetch` follows redirects | `proxy/handler.ts` | SSRF via route config or redirect |
| Gateway API key forwarded upstream in `Authorization` | `proxy/handler.ts` | Credential leak to upstream |
| `GET /keys` returns `keyHash` | `keys.service.ts` | Hash disclosure |
| Route lookup calls Redis without a fallback | `proxy/handler.ts` | Redis outage gives 502, so "fail-open" was false |
| Query string read from client header `x-original-search` | `proxy/handler.ts` | Real query dropped, client controls upstream query |
| Base path of target URL dropped when a sub-path is present | `proxy/handler.ts` | Wrong upstream URL |
| `content-encoding` kept after `fetch` decompressed the body | `proxy/handler.ts` | Corrupt responses for gzip upstreams |
| No upstream timeout | `proxy/handler.ts` | Slow upstream pins connections forever |
| Rate-limit key uses the full path | `rateLimiter.ts` | Limit bypass by varying the path |
| Fixed 60s bucket TTL | Lua scripts | Bucket resets early when refill takes longer than 60s |
| `refillRate = 0` divides by zero | Lua scripts | `inf` passed to `math.ceil` |
| Metrics label uses raw path | `metrics.ts` | Unbounded label cardinality |
| `/debug-sentry`, `/test-rate-limit`, `/keys/protected` exposed | `app.ts`, `keys.ts` | Test routes in production |
| `SIGTERM` handler in `tracing.ts` calls `process.exit` | `tracing.ts` | Races and defeats graceful shutdown |
| Default `JWT_SECRET` accepted in production | `env.ts` | Forgeable sessions |
| Model trained on synthetic traffic where every request has about 500 request bytes | `train.py` | Every real GET (0 bytes) looks anomalous |
| Consumer auto-commits offsets and has no DLQ topic | `consumer.py` | README claims of at-least-once and DLQ were false |

## Phase 1: security and correctness

- [x] `POST /internal/alerts` requires an HMAC signature
- [x] `POST /keys` derives tenant from the session only
- [x] Remove unauthenticated `/auth/register`, `/tenants`; add `/auth/signup` and admin-only team management
- [x] Tenant isolation audit, cross-tenant tests against real Postgres
- [x] Role hierarchy in `requiredRole`
- [x] Per-tenant webhooks: HMAC signing, retries, dead-letter state, SSRF guard, delivery log
- [x] dotenv loaded by `env.ts`; tests never read `.env`
- [x] Hardcoded values moved to the env schema
- [x] Rename `slindingWindow.ts`
- [x] Kafka optional at startup, degraded health
- [x] Proxy defects from the table above

## Phase 2: real features

- [x] Per-tenant rate-limit config (Postgres, Redis cache, admin API and UI)
- [x] Real analytics from `request_logs` (batched writes, retention job)
- [x] Persisted anomalies with score and SHAP attribution, shown in the dashboard
- [x] AI service: env config, reconnects, JSON logs, `/health`, versioned models, documented data
- [x] `/health/live`, `/health/ready`
- [~] Graceful shutdown: implemented, but its test skips on Windows and has not run yet (CI on Linux will be the first run)

## Phase 3: tests

- [x] Lua scripts tested against real Redis; Lua reimplementation mock deleted
- [x] Real pipeline e2e test: gateway, Kafka, consumer, alert, webhook
- [x] pytest for the consumer, run in CI
- [x] Load runner fails loudly; end-to-end section uses real HTTP with auth, rate limit, proxy
- [x] Coverage in CI with thresholds on gateway core

## Phase 4: observability and ops

- [x] One request id and trace id in the logs of the gateway, consumer, alert handling and webhook worker, and sent to the upstream as headers. Generated even with OpenTelemetry off, and asserted by the pipeline e2e test. Inbound `traceparent` is honoured only from a trusted proxy and on `/internal/alerts`
- [x] Prometheus metrics; the webhook queue depth gauge existed but was never set, and is now polled. Grafana dashboard provisioned by compose
- [x] Production Dockerfiles for gateway, frontend, ai-service: multi-stage, non-root, healthchecks
- [x] `pnpm demo`: the `full` compose profile, seed and live demo traffic
- [-] Metrics from ai-service: it has `/health` counters only. The brief lists gateway metrics, and adding a second scrape target was not needed for them
- [~] Webhook jobs re-enqueued by the sweeper log under a new trace and the delivery id, because the context is on the queue job and not in `webhook_deliveries`
- [~] With OpenTelemetry on, a locally started trace has a parent span that is never exported, so a backend shows a missing root span. Tracing is off by default
- [~] The queue depth gauge keeps its last value during a Redis outage
- [~] The consumer commits per message: about 130 messages/s in one informal reading in the demo stack, well under the gateway's measured throughput, so sustained peak traffic builds Kafka lag rather than losing data

## Phase 5: UI

- [x] Design tokens, light/dark, component set
- [x] Pages: login/signup, overview, routes, keys, rate limits, anomalies, webhooks, team
- [x] Playwright e2e, axe checks and browser verification
- [~] Tested with mocked responses: the stale-data banner and the `/auth/me` failure state. Not measured: layout shift. "Mobile" means a 390 px viewport in desktop Chromium
- [-] CSP headers, a signed-out visitor's brief view of the empty shell, and losing a one-time secret if a session expires while its dialog is open: left as known limitations, as they are not worth the complexity for a demo-scale dashboard

## Phase 6: docs

- [x] README rewrite with real benchmarks, methodology, screenshots
- [x] OpenAPI spec with a drift test, ADRs, CLAUDE.md gotchas updated
- [x] Interview talking points, resume bullets
- [-] GIF of the dashboard: the brief allowed screenshots or a GIF, and screenshots stay accurate with less effort

## Not verified

- GitHub Actions has never run these workflows, including the graceful shutdown test, which skips on Windows, and the CI demo job
- Multi-instance load: the benchmark runs one gateway process
- Neon: migrations have not been applied to the real database, which was set up with `db:push`, so the first migration may conflict

## Design decisions fixed up front

- **Analytics store:** raw `request_logs` in Postgres, written by a bounded in-process batcher, with a retention job. Simplest honest option; analytics do not depend on Kafka. Percentiles use `percentile_cont`.
- **Alert idempotency:** `anomalies` has a unique `(tenant_id, request_id)`, so Kafka redelivery creates no duplicate alert.
- **Webhook outbox:** a `webhook_deliveries` row is written before enqueueing; a sweeper re-enqueues rows left pending by a Redis outage.
- **Health semantics:** Postgres down means not ready (503) because auth needs it. Redis or Kafka down means ready but `degraded` (200), matching fail-open behaviour.
- **Performance finding:** the gateway path reaches about 4 to 7 percent of a bare upstream's throughput on one process, and absolute numbers vary about threefold between runs. A CPU profile found no single hotspot. See the README.
- **Test split:** `pnpm test` runs unit tests with no services. `pnpm test:integration` needs Postgres and Redis, and refuses any database that is not local and named `*_test`.
