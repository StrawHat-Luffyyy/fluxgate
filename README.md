# FluxGate

FluxGate is a multi-tenant API gateway. Tenants put their upstream services behind it and get API key auth, per-tenant rate limiting, request analytics, and anomaly alerts delivered as signed webhooks. It is a Hono gateway on Node, a Next.js dashboard, and a Python consumer that scores traffic from Kafka. Everything below can be checked against the code, a test, or a command you can run.

![Overview page of the FluxGate dashboard](docs/screenshots/overview-dark.png)

## Quickstart

You need Docker and pnpm. This builds and starts the whole system:

```bash
pnpm demo
```

| What | Where |
| --- | --- |
| Dashboard | <http://localhost:3001>, as `admin@fluxgate-demo.example.com` or `viewer@fluxgate-demo.example.com`, password `fluxgate-demo-password` |
| Gateway API | <http://localhost:3000> |
| Grafana | <http://localhost:3002>, no sign-in needed to view |
| Prometheus | <http://localhost:9090> |

`pnpm demo:down` stops it, and `pnpm demo:reset` recreates the demo tenant. The credentials and secrets are public and only for this demo, so all ports bind to loopback.

**What is real in the demo:** the seed creates a tenant and seven days of synthetic `request_logs`, so that charts have a history. A traffic generator then sends real requests through the real gateway, including an oversized response every five minutes. Every anomaly and webhook delivery you see came through the full pipeline.

## Architecture

```mermaid
flowchart LR
    Client -->|Bearer API key| Auth
    Browser[Dashboard] -->|Session cookie| API[Dashboard API]

    subgraph Gateway
        Auth --> Telemetry --> Limit[Rate limit] --> Proxy
        Telemetry -.->|never awaited| Buffers[Two bounded buffers]
        API
        Internal["/internal/alerts"]
        Worker[Webhook worker]
    end

    Auth <--> Redis[(Redis)]
    Auth <--> PG[(Postgres)]
    Limit <-->|Lua| Redis
    Proxy -->|SSRF guard| Upstream[Tenant upstream]
    Buffers -->|batched| PG
    Buffers --> Kafka[[Kafka]]
    API <--> PG
    Kafka --> Consumer[AI consumer]
    Consumer -->|HMAC signed| Internal
    Consumer -->|bad messages| DLQ[[DLQ topic]]
    Internal -->|anomaly + outbox, one transaction| PG
    Internal --> Queue[BullMQ]
    Queue --> Worker
    Worker -->|signed webhook| Receiver[Tenant receiver]
    Prometheus -->|scrape| Gateway
    Grafana --> Prometheus
```

### What happens to a request

1. **Auth** hashes the bearer key and looks it up, caching for 60 seconds in Redis. With no database and no cache it answers 503: it fails closed.
2. **Telemetry** wraps everything after auth, so 429s and upstream failures are recorded too. It emits after the response body finishes, and never awaits I/O.
3. **Rate limit** runs a Lua script in Redis with one bucket per tenant, using Redis time so gateway clocks do not matter. The tenant's algorithm and limits come from Postgres, cached in process and in Redis. A Redis error lets the request through, with `X-RateLimit-Fallback: fail-open`.
4. **Proxy** resolves the first path segment to the tenant's route. The target goes through `guardedFetch`, which checks addresses at connection time, so DNS rebinding does not get past it, and never follows redirects. The API key and session cookie are not forwarded.

Afterwards, the consumer scores the request from Kafka. If it is anomalous, it POSTs an HMAC-signed alert. The gateway stores the anomaly and its webhook deliveries in one transaction and sends signed webhooks with retries.

One request ID and trace ID follow this whole path through the logs of every process. `tests/e2e/pipeline.e2e.test.ts` asserts it.

## Features

- **Tenancy:** signup creates a tenant. Admins and viewers have enforced roles. Tests in `tests/integration/tenant-isolation.test.ts` prove that cross-tenant access fails.
- **API keys:** create, rotate and revoke. Keys are stored as hashes and shown once.
- **Rate limiting:** token bucket, leaky bucket or sliding window, chosen per tenant.
- **Analytics:** traffic, p50/p95/p99 latency, error rate, rate-limit hits, top routes and top consumers, from real request logs.
- **Anomaly detection:** Isolation Forest with SHAP attribution, plus a range guard, with triage status in the dashboard.
- **Webhooks:** per-tenant endpoints with HMAC signatures, encrypted secrets, retries, a dead state, manual retry and a delivery log.
- **Operations:** liveness and readiness endpoints, graceful shutdown, structured logs with trace IDs, Prometheus metrics, a provisioned Grafana dashboard, and non-root images with healthchecks.
- **Dashboard:** every feature above, with light and dark themes, and role-aware actions.

| | |
| --- | --- |
| ![Anomalies](docs/screenshots/anomalies-dark.png) | ![Webhooks](docs/screenshots/webhooks-dark.png) |
| ![Rate limits](docs/screenshots/rate-limit-dark.png) | ![Light theme](docs/screenshots/overview-light.png) |

## Benchmarks

Measured with `pnpm bench`, which needs k6. It aborts rather than reports if a dependency is down, the gateway degrades or any request fails a check. Full results and method: [`docs/benchmarks/results.md`](docs/benchmarks/results.md) and [`results-faster-run.md`](docs/benchmarks/results-faster-run.md).

**Hardware:** a laptop with an Intel i5-12450H (12 logical cores) and 16 GB of memory, on Windows. k6, the gateway and the upstream shared that machine, and Postgres, Redis and Redpanda ran in Docker Desktop on it. The gateway was one Node process in production mode, with all of auth, rate limiting, proxying and telemetry on.

Requests per second, each row a 5 second ramp plus 20 seconds:

| Virtual users | Direct to upstream, run A | Through gateway, run A | Direct to upstream, run B | Through gateway, run B |
| --- | --- | --- | --- | --- |
| 50 | 39,177 | 1,547 | 12,617 | 534 |
| 200 | 33,069 | 1,718 | 12,231 | 562 |
| 500 | 30,874 | 1,824 | 9,482 | 623 |

Median latency through the gateway at 50 virtual users was 27 ms in run A and 78 ms in run B.

**How to read this:**

- **Runs of the same code differed by about three times.** The baseline with no gateway moved by the same factor, so this comes from the machine, though the cause was not identified. Treat the absolute numbers as rough. The gateway delivers about 4 to 7 percent of the bare upstream's throughput in both runs.
- **That upstream does almost nothing,** so this is the gateway's own ceiling on one process. Real upstreams are slower, and the gap would be smaller.
- **[A CPU profile under load](docs/benchmarks/cpu-profile.md) found no single bottleneck.** Time is spread across undici, logging, Drizzle and Hono on one saturated event loop. The next step is more processes, which has not been load tested here.
- **One other run aborted before finishing, and its error output was not kept,** so the cause is unknown.

Rate limit enforcement over real HTTP: 2,000 requests against a limit of 500 gave exactly 500 served and 1,500 limited. The Lua scripts ran at tens of thousands of operations per second, also varying by machine state, and admitted exactly 1,000 of 5,000 racing calls over 16 connections in every run.

The previous 10,234 req/s claim in this README measured only `/health`, and has been withdrawn. The benchmark sets `ALLOW_PRIVATE_TARGETS=true` because its upstream is on localhost, so the SSRF address check is not in the measured path.

## Design decisions and trade-offs

The reasoning is in `docs/adr/`.

- **The rate limiter fails open, and auth fails closed** ([ADR 0001](docs/adr/0001-rate-limiter-fails-open.md)). A Redis outage should not take every tenant offline, but an unverified key must never reach an upstream. The cost is no rate limiting during an outage, so it has its own metric.
- **Telemetry is fire-and-forget** ([ADR 0002](docs/adr/0002-telemetry-never-blocks-traffic.md)). Two bounded buffers mean a Kafka or Postgres outage cannot block the telemetry step or affect the other sink. Postgres is still needed for auth and route lookups on a cache miss. The cost is that records can be lost, and a counter says how many. It is the wrong design for billing.
- **Isolation Forest, on synthetic data** ([ADR 0003](docs/adr/0003-isolation-forest-with-range-guard.md)). It needs no labels, and SHAP lets an alert explain itself. A range guard catches extreme values the forest misses. The cost is that its accuracy on real traffic is unknown.
- **Transactional outbox for webhooks** ([ADR 0004](docs/adr/0004-webhooks-use-a-transactional-outbox.md)). A crash cannot lose a webhook, and unique `(tenant_id, request_id)` makes Kafka redelivery harmless. Tenants still see at-least-once delivery.

## Known limitations

- **The model has never seen real traffic.** Latencies of about 2 to 14 seconds are flagged by neither detector, and it scores single requests, so it misses attacks visible only in aggregate. See `ai-service/README.md`.
- **The consumer is slower than the gateway.** It commits synchronously per message, and handled about 130 messages/s in one informal reading while draining a backlog in the demo stack. Sustained peak traffic builds Kafka lag rather than losing data.
- **One gateway process uses one core.** See the benchmarks. Several instances share state through Redis, but this repository has not load tested that setup.
- **Analytics query raw rows,** which will slow down as volume grows. Rollups would be needed at high volume.
- **No per-tenant alert throttling,** so a tenant whose traffic is all anomalous gets one webhook per request.
- **Signup reveals whether an email exists,** through a 409.
- **Logging out clears the cookie but does not revoke the token,** which stays valid for up to 24 hours. Webhook secrets are shown once and cannot be rotated without recreating the endpoint.
- **API error bodies are not uniform yet:** middleware and services differ slightly. The OpenAPI spec documents both shapes.
- **Browser preflight requests to `/gateway` get a 401,** so calling the gateway directly from a browser does not work.
- **Dashboard and API must share a site,** because the session cookie is `SameSite=strict`. There is no password reset or email invitation.
- **Not yet proven outside this machine:** see the [testing](#testing) section.

## API

[`docs/openapi.json`](docs/openapi.json) is the OpenAPI 3.1 spec, and a test fails if it drifts from the routes in the code.

## Configuration

The gateway validates these at startup (`src/config/env.ts`). If `NODE_ENV` is unset it means production, and production refuses to start without the four required secrets.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `production` | `pnpm dev` sets `development` |
| `PORT` | `3000` | Listen port |
| `LOG_LEVEL` | `info` in production, otherwise `debug` | Pino level |
| `DATABASE_URL` | local compose Postgres | Postgres |
| `REDIS_URL` | `redis://localhost:6379` | Redis |
| `REDIS_COMMAND_TIMEOUT_MS` | `250` | When the limiter gives up and fails open |
| `KAFKA_BROKER` | `localhost:19092` | Comma-separated brokers |
| `KAFKA_TOPIC` | `gateway.traffic.logs` | Telemetry topic |
| `JWT_SECRET` | dev value; **required in production** | Session signing, at least 32 characters |
| `INTERNAL_ALERT_SECRET` | dev value; **required in production** | Alert HMAC, shared with `ai-service` |
| `SECRETS_ENCRYPTION_KEY` | dev value; **required in production** | Encrypts webhook secrets |
| `METRICS_TOKEN` | none; **required in production** | Bearer token for `/metrics` |
| `CORS_ORIGINS` | `http://localhost:3001` | Dashboard origins |
| `COOKIE_SECURE` | `true` in production | Secure session cookie |
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-For` and inbound `traceparent`. Set only behind a proxy you run |
| `ALLOW_PRIVATE_TARGETS` | `false` | Turns off SSRF protection. Refused in production unless `FLUXGATE_DEMO_MODE=true` |
| `UPSTREAM_TIMEOUT_MS` | `30000` | Upstream timeout |
| `WEBHOOK_MAX_ATTEMPTS` | `6` | Attempts before a delivery is `dead` |
| `WEBHOOK_BACKOFF_MS` | `2000` | Base of the exponential backoff |
| `WEBHOOK_TIMEOUT_MS` | `5000` | Per-attempt timeout |
| `OTEL_ENABLED`, `OTLP_ENDPOINT` | `false`, local | OpenTelemetry trace export |
| `SENTRY_DSN` | none | Sentry |

The dashboard reads `NEXT_PUBLIC_API_URL` at build time. The consumer's settings are in `ai-service/settings.py` and `ai-service/README.md`.

## Development

```bash
pnpm install
docker compose up -d --wait postgres redis redpanda
DATABASE_URL=postgresql://fluxgate:fluxgate@localhost:5432/fluxgate pnpm db:migrate
pnpm dev
pnpm --filter frontend dev --port 3001
```

`.env.example` lists every setting.

## Testing

| Command | What it runs |
| --- | --- |
| `pnpm test` | Unit tests, no services |
| `pnpm test:integration` | Real Postgres and Redis, including every Lua script |
| `pnpm test:coverage` | The same, enforcing coverage thresholds |
| `pnpm test:e2e` | Real processes: gateway, Kafka, Python consumer, alert, webhook |
| `pnpm --filter frontend test:e2e` | Playwright in Chromium, against the real gateway |
| `.venv/Scripts/python -m pytest` in `ai-service/` | The consumer, including the shipped model |
| `pnpm bench` | Benchmarks, needs k6 |

Integration and e2e tests refuse any database that is not local and named `*_test`.

**Not yet verified:** GitHub Actions has not run these workflows, and they will first run when this branch is pushed. That includes the graceful shutdown test, which skips on Windows, and the CI demo job.
