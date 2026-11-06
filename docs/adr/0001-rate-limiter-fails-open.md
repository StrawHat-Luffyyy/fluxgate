# ADR 0001: The rate limiter fails open

Status: accepted

## Context

Every gateway request runs a Lua script in Redis to decide whether it is within the tenant's limit. Redis can fail or stall, and whatever the gateway does then applies to all tenants at once.

The choices were to reject traffic while Redis is unavailable (fail closed), or to let it through unlimited (fail open).

## Decision

Fail open. Any Redis error or timeout lets the request through, with `X-RateLimit-Fallback: fail-open` on the response and an increment of `fluxgate_rate_limit_fail_open_total`. Redis commands time out after `REDIS_COMMAND_TIMEOUT_MS` (250 ms by default), so a stalled Redis adds bounded latency to each request rather than hanging it.

Auth does not make the same choice. It fails closed: with no database and no cache it returns 503, because an unverified API key must never reach an upstream.

## Consequences

- A Redis outage does not become an outage for every tenant. `tests/integration/degraded.test.ts` and `tests/e2e/degraded.e2e.test.ts` check this.
- While Redis is down there is no rate limiting, so upstreams lose that protection exactly when something else is already wrong. A tenant that notices can send unlimited traffic.
- The outage has to be visible, since traffic will not show it: the metric above is a stat panel on the Grafana dashboard.
- An alternative for later is a local in-process limiter as the fallback, which gives each gateway instance an approximate limit during an outage. It was not built because it adds a second implementation of the limit that is only exercised during failures.
