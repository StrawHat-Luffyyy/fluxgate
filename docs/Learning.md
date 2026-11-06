# Technical Learnings

## Day 1

- **Fail Fast Principle:** Validating configuration at startup prevents silent, delayed runtime crashes caused by missing environment variables.
- **TypeScript Local Imports:** When using `NodeNext` module resolution, local file imports must include the `.js` extension (e.g., `import app from './app.js'`) so the compiled output maps correctly.

## Day 2

- **IDOR Prevention:** Always use UUIDs for primary keys in multi-tenant systems to prevent malicious actors from guessing sequential resource IDs.
- **Connection Pooling:** Without a connection pool, every request creates a new TCP database connection. Pooling reuses a small set of connections to prevent database exhaustion under load.
- **Drizzle vs. Prisma:** Drizzle avoids heavy Rust binaries, making it far superior for edge-native, zero-cold-start deployments.

## Day 3

- **Hashing vs Encryption:** API keys must be hashed (one-way), not encrypted (two-way), to protect upstream systems in the event of a database breach.
- **Prefixes:** Prefixing API keys (e.g., `fg_live_`) allows GitHub secret scanners to easily detect leaked keys.
- **Database Cascades:** Use `{ onDelete: 'cascade' }` on foreign keys to offload data cleanup to the Postgres engine, reducing backend code complexity and bugs.

## Day 4

- **Distributed Race Conditions:** Never use `READ -> CALCULATE -> WRITE` logic in application code for shared state. Use Redis Lua (`EVAL`) to execute logic atomically on the data store itself.
- **Fail-Open:** Infrastructure components (like caches) should be designed to fail gracefully. If the rate limiter dies, let traffic through rather than causing a total system outage.
- **ZSET Collisions:** Always append cryptographic salt to timestamps when using them as members in a Redis Sorted Set to prevent millisecond collisions.

## Day 5

- **Stream Piping:** Never use `.json()` or `.text()` in a proxy layer unless inspection is explicitly required. Pass `c.req.raw.body` directly to prevent RAM exhaustion.
- **SNI / SSL Routing:** Upstream CDNs rely on the `Host` header matching the target domain. Always delete or rewrite the original Host header when proxying.
- **Masking:** API Gateways should strip framework footprint headers (`Server`, `X-Powered-By`) from upstream responses to reduce the surface area for targeted CVE attacks.

## Day 6

- **Kafka vs Queues:** Kafka is an append-only event stream ideal for audit logs (multiple consumers can read the same event). Queues are for single-execution tasks.
- **Graceful Shutdowns:** Always capture `SIGTERM` to close database/TCP connections and flush message buffers before the Node process exits to prevent data loss.
- **Routing Keys:** Providing a Kafka message key ensures deterministic partition hashing, maintaining chronological order for specific entities (like tenants).

## Day 7

- **Polyglot Architecture:** Use the right tool for the job. Node.js for async network routing; Python for matrix math and ML. Kafka acts as the universal translator.
- **Unsupervised ML:** Isolation Forests isolate outliers based on feature splits, making them highly effective for cybersecurity where malicious datasets are not clearly labeled.
- **Consumer Groups:** Allow horizontal scaling of worker processes. Kafka handles the load balancing of partitions automatically across members of the same group.

## Day 8

- **Queue vs Stream:** Use Kafka for an immutable history of events that many services read. Use BullMQ for imperative tasks (like sending an email) that need execution retries and success/fail states.
- **Connection Blocking:** Tools that use Redis blocking operations (`BLPOP`) must have their own dedicated connection instances so they don't freeze standard `GET/SET` operations.
- **HTTP 202:** Use HTTP 202 Accepted for API endpoints that enqueue a job rather than processing it synchronously.

## Day 9

- **Percentiles over Averages:** Averages hide terrible experiences for the minority of users. P99 ensures we optimize for the worst 1% of response times.
- **Pull vs Push:** The pull monitoring model prevents monitoring failures from taking down the application network thread.
- **Cardinality:** Never put unbounded dynamic data (like User IDs or random strings) into Prometheus labels/tags, or it will exhaust memory. Group them into standardized route paths (e.g., `/user/:id`).

## Day 10

- **Multi-Stage Builds:** Separate the environment that *builds* the code from the environment that *runs* the code to maximize security and minimize container size.
- **Docker Layer Caching:** Always copy dependency manifests and install them before copying application code to utilize Docker's cache and speed up build pipelines.
- **CI Pipelines:** Automated pipelines remove human error from deployments by enforcing compilation and tests before code ever reaches production.
