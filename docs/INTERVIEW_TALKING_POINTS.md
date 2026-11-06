# Interview talking points

For each component: the problem, the design choice, the trade-off, and how it fails. Numbers are in the README and `docs/benchmarks/results.md`, so quote those rather than memorising them.

## Rate limiter

- **Problem:** several gateway instances must share one limit per tenant, without a race between reading and updating the counter.
- **Choice:** Lua scripts in Redis, which run atomically, with Redis time so gateway clocks do not matter. Token bucket, leaky bucket and sliding window, chosen per tenant. The key is per tenant and not per path, because path-based keys gave a fresh bucket to anyone who varied the URL.
- **Trade-off:** every request costs a Redis round trip. The sliding window stores one entry per request, so it uses more memory than the buckets.
- **Failure:** any Redis error or a 250 ms timeout fails open, with a response header and a metric. Be ready to defend this: availability over protection, and the outage must be visible because traffic will not show it. A local fallback limiter is the next step.
- **Proof:** `tests/integration/rate-limit-lua.test.ts` runs the real scripts. The benchmark has an atomicity check: 5,000 racing calls over 16 connections against a limit of 1,000 must admit exactly 1,000.
- **Note:** the leaky bucket is a meter, not a queue. Excess requests get an immediate 429.

## Auth and tenancy

- **Problem:** two kinds of caller, both of which must only ever see their own tenant's data.
- **Choice:** SHA-256 hashed API keys for traffic (high-entropy keys, so a fast hash is correct, and bcrypt would cost every request). Session JWT in an HttpOnly cookie for the dashboard, with role and tenant re-read from the database on each request, so demotion applies immediately.
- **Trade-off:** that database read costs a query per dashboard request, in exchange for instant revocation. API key lookups are cached for 60 seconds, so a revoked key is explicitly evicted, and a Redis failure during that could leave a short window.
- **Failure:** no database and no cache gives 503. Auth fails closed, the opposite of the limiter, and you should be able to explain why they differ.
- **Found in audit:** the original `/auth/register` accepted `tenantId` and `role` from the body, so anyone could become admin of any tenant. `/tenants` had no auth.

## Proxy and SSRF

- **Problem:** tenants supply URLs that the gateway then calls from inside your network.
- **Choice:** `guardedFetch` checks the resolved address at connection time through a custom lookup, not just the hostname beforehand. That closes DNS rebinding. It never follows redirects. The API key and the dashboard session cookie are not forwarded; other cookies are.
- **Trade-off:** a custom dispatcher instead of plain fetch, and no redirect support for upstreams.
- **Failure:** a blocked target is an error to the tenant, and a timeout gives a gateway error that telemetry still records.
- **Found in audit:** `//host` in a path replaced the upstream host in `new URL()`, which made an open proxy.

## Telemetry pipeline

- **Problem:** recording a request must not affect serving it.
- **Choice:** `emitTelemetry` never awaits and never throws. Two independent bounded buffers feed Postgres and Kafka.
- **Trade-off:** at-most-once. A crash loses buffered records, and a long outage drops them. A counter reports how many. Wrong for billing.
- **Failure:** bad rows in a batch are found by bisecting, so one bad row does not lose its neighbours.

## Analytics

- **Problem:** the old overview returned generated numbers.
- **Choice:** real aggregates over raw `request_logs` with `percentile_cont`, on a small separate connection pool, cached for 10 seconds.
- **Trade-off:** simplest honest option, but it scans raw rows. The answer at scale is rollups or a columnar store.
- **Failure:** the separate pool stops a heavy dashboard from starving auth of connections.

## Anomaly detection

- **Problem:** flag abnormal requests with no labels and no history.
- **Choice:** Isolation Forest with SHAP, plus a range guard, because a forest stops separating points beyond its training range: a 30 second request was not flagged by the forest alone.
- **SHAP units:** values are in isolation-tree path length. Negative means a shorter path, so more anomalous.
- **Trade-off:** say this first, before you are asked: it is trained on synthetic data, so its accuracy on real traffic is unknown. It has a blind spot at about 2 to 14 seconds of latency, and it cannot see aggregate attacks.
- **Failure:** auto-commit is off, so a crash reprocesses messages. Bad messages go to a real DLQ topic. Transient alert failures are retried and never sent to the DLQ. Models are checked against SHA-256 before loading, because joblib executes code.

## Webhooks

- **Problem:** alerts must be delivered, once where possible, to URLs you do not control.
- **Choice:** the anomaly and its delivery rows commit in one transaction (outbox). Unique `(tenant_id, request_id)` absorbs Kafka redelivery. A sweeper recovers rows that missed the queue. Payloads are signed over `timestamp.body`, and secrets are AES-256-GCM encrypted because they must be recoverable to sign.
- **Trade-off:** at-least-once to the tenant, who should deduplicate on the delivery ID.
- **Failure:** retries back off, then `dead`, then a manual retry from the dashboard. A 4xx is treated as permanent, apart from 408 and 429.

## Observability

- **Problem:** following one request across three processes.
- **Choice:** `AsyncLocalStorage` carries a request ID and W3C trace ID into every log line, with no plumbing through function arguments, and they travel as headers through Kafka and the queue. They exist even with OpenTelemetry off.
- **Trade-off:** inbound `traceparent` is honoured only from a trusted proxy and on the signed alert route, since a client choosing its own trace ID could join its logs to another tenant's.
- **Failure:** jobs from the sweeper start a new trace. With OpenTelemetry on, a locally started trace has an unexported parent span.
- **Found in review:** the queue depth gauge was defined but never set.

## Throughput finding

- **What was measured:** the old README claimed 10,234 req/s, but that was measuring `/health`. Through the real path it is far lower: see the benchmarks.
- **What the profile showed (`docs/benchmarks/cpu-profile.md`):** no single hotspot. CPU is spread across undici, logging, Drizzle and Hono, on one saturated event loop. The per-request work is real, so the next step is running more processes, not a micro-optimisation.
- **Why it matters:** being able to say "I replaced a flattering number with an honest one and profiled the difference" is a stronger answer than a big number.
- **Caveat:** repeated runs of the same code on this laptop differed by about three times, and the baseline moved with them. The stable figure is the ratio: about 4 to 7 percent of a bare upstream that does nothing.

## Dashboard

- **Problem:** the old UI used few of the real endpoints.
- **Choice:** static shells with client data fetching, because all data sits behind the session cookie. Native `<dialog>`, hand-built components, and no fake data: an empty state is what shows when data is absent.
- **Trade-off:** a signed-out visitor briefly sees the empty shell. Role gating in the UI is only a convenience: the API enforces it.
- **Found in review:** an open redirect through a tab character in `next`, since URL parsers strip tabs and turn `/<TAB>/evil` into `//evil`. The fix is to parse the URL and compare origins, not prefix-check strings.

## Questions to expect

- **"Why not fail closed?"** See the rate limiter. Know the counter-argument: an expensive upstream may prefer rejection, which could be a per-tenant setting.
- **"How would you scale this?"** More gateway processes, since state is in Redis and Postgres. Partition the Kafka topic and run more consumers. Batch consumer commits. Roll up analytics.
- **"What would you do next?"** Per-tenant model training on real traffic, alert throttling, and a load test with several instances.
- **"Did you write this yourself?"** Answer honestly. It was built with heavy AI assistance, so be sure you can explain each section here without notes.
