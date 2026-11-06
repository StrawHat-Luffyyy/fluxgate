# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

FluxGate is a multi-tenant API gateway. Three parts live here: the Hono gateway (`src/`), a Next.js dashboard (`frontend/`), and a Python anomaly-detection consumer (`ai-service/`). `docs/IMPROVEMENT_PLAN.md` tracks what is done and what is not.

## Commands

pnpm workspace (root package is the gateway, `frontend` is the second package). Use pnpm; ignore `frontend/package-lock.json`.

```bash
docker compose up -d --wait postgres redis redpanda   # :5432, :6379, Kafka on :19092
pnpm db:migrate                              # apply drizzle/ to DATABASE_URL
pnpm dev                                     # gateway on :3000, tsx watch, NODE_ENV=development
pnpm test                                    # unit tests, no services
pnpm test -- tests/unit/path.test.ts         # one file; add -t "name" for one test
pnpm test:integration                        # real Postgres and Redis, unit tests too
pnpm test:coverage                           # the same, enforcing thresholds
pnpm test:e2e                                # real gateway and Python consumer processes
pnpm bench                                   # real benchmarks, needs k6; writes docs/benchmarks/
pnpm demo                                    # the whole system in Docker, seeded, with live traffic
pnpm demo:reset                              # recreate the demo tenant; pnpm demo:down stops it
pnpm exec tsc --noEmit                       # type check (src/ only: tests are not type-checked)
pnpm build                                   # tsc to dist/
pnpm db:generate                             # create a migration from src/db/schema.ts
pnpm --filter frontend dev --port 3001       # dashboard; CORS_ORIGINS defaults to :3001
pnpm --filter frontend lint
pnpm --filter frontend build
pnpm --filter frontend test:e2e              # Playwright against a real gateway; ports 3005 and 3006
```

Python, run from inside `ai-service/`:

```bash
python -m venv --system-site-packages .venv
.venv/Scripts/pip install -r requirements.txt -r requirements-dev.txt
.venv/Scripts/python -m pytest
.venv/Scripts/python train.py       # writes a new version under models/
INTERNAL_ALERT_SECRET=... .venv/Scripts/python consumer.py
```

## Architecture

### Request path through `/gateway/*`

`authMiddleware` → `telemetryMiddleware` → `rateLimiterMiddleware(resolveRateLimitConfig)` → `proxyHandler` (wired in `src/routes/gateway.ts`).

1. **Auth** hashes the bearer API key and looks it up, cached 60s in Redis. Fails closed: no database and no cache gives 503.
2. **Telemetry** wraps everything after auth, so 429s and upstream failures are recorded. It emits after the response body finishes, and never awaits I/O.
3. **Rate limit** runs a Lua script in Redis, using Redis time, with one bucket per tenant. Config is per tenant in `rate_limit_configs`, cached in process (5s) and in Redis (60s). Any Redis error fails open with `X-RateLimit-Fallback: fail-open`. This is deliberate.
4. **Proxy** takes the first path segment after `/gateway` as the route prefix and resolves it through Redis, falling back to Postgres. All tenant-supplied URLs go through `guardedFetch` in `src/lib/ssrf.ts`, which checks addresses at connection time and never follows redirects. The API key and session cookie are not forwarded.

### Telemetry and anomalies

`emitTelemetry` feeds two independent bounded buffers: `requestLogWriter` (batched into `request_logs`, the source of all analytics) and the Kafka producer (topic `gateway.traffic.logs`). Either can be down without affecting traffic or the other.

`ai-service` commits offsets manually after processing, scores with an Isolation Forest plus a range guard, and POSTs HMAC-signed alerts to `/internal/alerts`. `recordAnomaly` inserts the anomaly and its webhook deliveries in one transaction, and unique `(tenant_id, request_id)` makes redelivery harmless. `webhookWorker` delivers signed payloads, retries with backoff and marks rows `dead`; its sweeper re-enqueues rows left `pending` by a Redis outage.

`RequestFeatures` in `src/proxy/extractor.ts` is the wire contract with `parse_event` in `ai-service/scoring.py`. The alert body is `alertSchema` in `src/routes/internal.ts`. Change both sides together.

### Auth

- **API keys** (`middleware/auth.ts`): `Authorization: Bearer`, for proxied traffic.
- **Dashboard sessions** (`middleware/dashBoardAuth.ts`): JWT in the HttpOnly `Fluxgate_session` cookie. Role and tenant are re-read from the database on each request.

Both set `tenantId` on the Hono context, and every query must filter on it. `requiredRole("viewer")` allows that role and above. Tenants are created only through `POST /auth/signup`; other users only by an admin through `/team`.

### Layout conventions

- Routes in `src/routes/` stay thin, validate with `parseBody` and `parseId` (`src/lib/validate.ts`), and call `src/services/*.service.ts`.
- Throw `AppError` for expected failures; `middleware/errorHandler.ts` turns it into the JSON error response.
- `app.ts` builds the app with no network binding, and `server.ts` does startup and shutdown. Tests call `app.request(...)` directly.
- Source is ESM with `NodeNext` resolution, so relative imports need a `.js` extension, including in tests.
- Add environment variables to the Zod schema in `src/config/env.ts`.

## Gotchas

- **`.env` may point at a real database.** `env.ts` loads it unless `NODE_ENV=test`, and it does not override variables already set. Any local command outside the test suites should set `DATABASE_URL` explicitly unless you mean to use `.env`. Integration and e2e tests refuse any database that is not local and named `*_test`.
- **Unset `NODE_ENV` means production**, which refuses to start without `JWT_SECRET`, `INTERNAL_ALERT_SECRET`, `SECRETS_ENCRYPTION_KEY` and `METRICS_TOKEN`. `pnpm dev` sets development.
- **Set rate limit headers on `c.res`, not with `c.header()`,** after `next()`: `c.header()` is lost when a handler returns a raw `Response`, as the proxy does.
- **Tests run `ALLOW_PRIVATE_TARGETS=true`** because upstreams are on localhost. `tests/integration/ssrf-blocked.test.ts` and `tests/unit/ssrf.test.ts` turn it off with `vi.hoisted`, which is the pattern to copy.
- **The model is trained on synthetic data.** See `ai-service/README.md` for the limitations, including the latency range it does not flag.
- **Browser tests need the `fluxgate_ui_test` database.** Create it once; migrations run at startup. They use Redis db 1 because a running demo's worker on db 0 would take their webhook jobs.
- **A `.next` folder from before a page was deleted breaks `next build`** with a missing-module type error. Delete `frontend/.next`.
- **Inbound `traceparent` is ignored** except behind `TRUST_PROXY` and on `/internal/alerts`, on purpose: a client choosing its trace id could join its logs to another tenant's.
- **The demo seed is compose-only.** Its routes and encrypted secrets are valid only on the compose network, and `assertLocalDatabase` refuses other databases.
- **`docs/openapi.json` must change with the routes.** `tests/unit/openapi.test.ts` fails on any route in only one of them.
- **SIGTERM tests skip on Windows**, where Node's `kill()` ends the process immediately. CI on Linux runs them.

## Frontend

`frontend/AGENTS.md` applies: this Next.js version (16) has breaking changes, so read the relevant guide in `node_modules/next/dist/docs/` before writing frontend code.
