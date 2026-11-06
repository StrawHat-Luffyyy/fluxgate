# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

FluxGate is a multi-tenant API gateway. Three parts live here: the Hono gateway (`src/`), a Next.js dashboard (`frontend/`), and a Python anomaly-detection consumer (`ai-service/`).

## Commands

pnpm workspace (root package is the gateway, `frontend` is the second package). Use pnpm; ignore `frontend/package-lock.json`.

```bash
docker-compose up -d                         # Postgres :5432, Redis :6379, Redpanda (Kafka) :19092
pnpm dev                                     # gateway on :3000, tsx watch
pnpm vitest run                              # all tests; no running services needed
pnpm vitest run tests/utils/crypto.test.ts   # one file
pnpm vitest run -t "test name substring"     # one test by name
pnpm exec tsc --noEmit                       # type check (src/ only: tests are not type-checked)
pnpm build                                   # tsc to dist/
pnpm db:generate                             # create a migration from src/db/schema.ts
pnpm db:push                                 # push the schema directly to DATABASE_URL
pnpm --filter frontend dev --port 3001       # dashboard; the gateway's CORS only allows :3001
pnpm --filter frontend lint
pnpm --filter frontend build
npx tsx tests/load-test-runner.ts            # benchmarks; overwrites docs/load-test-results.md
```

`tests/load-test.js` and `token-burst.js` are k6 scripts: run them with `k6 run`, not node or vitest.

Python consumer, run from inside `ai-service/` because it opens `model.pkl` and `baseline_data.pkl` by relative path:

```bash
pip install -r requirements.txt
python train.py      # regenerates both .pkl files (they are committed)
python consumer.py
```

CI runs `tsc --noEmit`, vitest and build for the backend; `next build` for the frontend; only `py_compile` for Python; and a Docker build that checks the container runs as user `fluxgate`.

## Architecture

### Request path through `/gateway/*`

`authMiddleware` → `rateLimiterMiddleware()` → `proxyHandler` (wired in `src/routes/gateway.ts`).

1. **Auth** hashes the bearer API key and looks up `api_keys.key_hash`, which sets `tenantId`. Raw keys are never stored.
2. **Rate limit** runs a Lua script in Redis, keyed `fluxgate:ratelimit:{tenantId}:{path}`. Any Redis error fails open: the request proceeds with `X-RateLimit-Fallback: fail-open`. This is deliberate.
3. **Proxy** takes the first path segment after `/gateway` as the route prefix and resolves it to `gateway_routes.target_url`, cached in Redis for 300s at `fluxgate:route:{tenantId}:{prefix}`. It forwards the request with W3C trace headers and streams the response back.
4. **Telemetry** is fire-and-forget: `void publishRequestLog(...)` sends to Kafka topic `gateway.traffic.logs`. It must never block or fail the proxied request.

### Anomaly pipeline

`ai-service/consumer.py` reads the topic and scores `[requestByteSize, responseByteSize, latencyMs]` with an Isolation Forest, then uses SHAP to name the main feature behind an anomaly. It POSTs to `/internal/alerts`, which enqueues a BullMQ job; `src/queue/webhookWorker.ts` (started in-process by `server.ts`) delivers the webhook.

`RequestFeatures` in `src/proxy/extractor.ts` is the contract between TypeScript and Python. Changing the field names means changing `consumer.py`, and changing the feature set means retraining with `train.py`.

### Two separate auth systems

- **API keys** (`middleware/auth.ts`): `Authorization: Bearer`, for proxied traffic.
- **Dashboard sessions** (`middleware/dashBoardAuth.ts`): JWT in the HttpOnly `Fluxgate_session` cookie, for `/admin`, `/analytics` and `GET /keys`. Role is re-read from the database on each request.

Both set `tenantId` on the Hono context, and it is the basis of tenant isolation, so queries should filter on it.

`requiredRole([...])` in `middleware/rbac.ts` is an exact match with no hierarchy: `requiredRole(["viewer"])` returns 403 for admins, so list every role that should have access.

### Layout conventions

- Routes in `src/routes/` stay thin and call `src/services/*.service.ts`.
- Throw `AppError` (`src/lib/AppError.ts`) for expected failures; `middleware/errorHandler.ts` turns it into the JSON error response.
- Log through `createChildLogger` from `src/lib/logger.ts`.
- `app.ts` builds the app with no network binding, and `server.ts` does startup (tracing, Kafka, worker, listen). Tests call `app.request(...)` directly.
- Source is ESM with `NodeNext` resolution, so relative imports need a `.js` extension, including in tests.
- Add environment variables to the Zod schema in `src/config/env.ts`.
- The filename `src/redis/scripts/slindingWindow.ts` is misspelled in the repo; import it as is.

## Gotchas

- **`.env` loading depends on import order.** `dotenv/config` is imported only in `src/db/index.ts`, and `env.ts` parses `process.env` once at import. Importing `env.js` before anything that pulls in `db/index.js` leaves `.env` values unread and silently uses the schema defaults.
- **Tests don't run the Lua scripts.** `tests/rate-limiter/redis-mock.ts` reimplements each algorithm in JS and picks one by matching substrings in the script text. A change to a Lua script needs the same change in the mock, and passing tests say nothing about the Lua itself. Check against real Redis.
- **Tests that import `app` need `db` and `redis` mocked** with `vi.mock`; see `tests/routes/admin.test.ts`, which queues database results in `mockDbResultQueue`.
- **`tests/pipeline/pipeline.test.ts` never touches Kafka or `consumer.py`.** It only exercises logic inside the test file, so it doesn't cover the Python side.
- **The rate limiter's config is not per-tenant.** `gateway.ts` calls `rateLimiterMiddleware()` with no arguments, so all gateway traffic gets the default token bucket (capacity 10, refill 2/s). The other algorithms are used only if a caller passes a config.
- **Kafka is required at startup.** `connectProducer` exits the process if the broker is unreachable, even though publish failures after startup are only logged.
- **`tests/load-test-runner.ts` can silently benchmark the mock.** If Redis refuses connections it falls back to the in-memory `mockRedisClient`, so start Redis first. Its "end-to-end" section requests `/health` through `app.request`, so it covers neither auth, rate limiting, proxying nor real HTTP.
- **Some routes have no auth:** `POST /internal/alerts`, and `POST /keys`, which accepts a `tenantId` from the request body when there is no session cookie.
- **Hardcoded or mocked values:** `getAnalyticsOverview` returns generated data rather than real traffic; the webhook URL in `webhookWorker.ts` is a fixed test URL; `consumer.py` hardcodes its broker and alert endpoint to localhost; the CORS origin in `app.ts` is fixed to `http://localhost:3001`.

## Frontend

`frontend/AGENTS.md` applies: this Next.js version (16) has breaking changes, so read the relevant guide in `node_modules/next/dist/docs/` before writing frontend code. API calls go through `apiFetch` in `frontend/app/lib/api.ts`, which sends cookies and redirects to `/login` on a 401. The gateway address comes from `NEXT_PUBLIC_API_URL`.
