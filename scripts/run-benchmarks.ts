/**
 * Reproduces the benchmark numbers in README.md. Every number comes from a run
 * against real services. It exits non-zero rather than report anything else.
 *
 *   docker compose up -d postgres redis redpanda
 *   pnpm build
 *   pnpm bench
 *
 * Needs k6 on PATH. Writes docs/benchmarks/results.md and results.json.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Redis } from "ioredis";
import postgres from "postgres";
import { tokenBucketLua } from "../src/redis/scripts/tokenBucket.js";
import { leakyBucketLua } from "../src/redis/scripts/leakyBucket.js";
import { slidingWindowLua } from "../src/redis/scripts/slidingWindow.js";

const REDIS_URL = process.env.BENCH_REDIS_URL ?? "redis://localhost:6379/3";
const DATABASE_URL =
  process.env.BENCH_DATABASE_URL ?? "postgresql://fluxgate:fluxgate@localhost:5432/fluxgate_bench";
const KAFKA_BROKER = process.env.BENCH_KAFKA_BROKER ?? "localhost:19092";
const GATEWAY_PORT = 3190;
const CONCURRENCY = [50, 200, 500];
const DURATION = process.env.BENCH_DURATION ?? "20s";
const REDIS_OPS = 100_000;
const RACING_CONNECTIONS = 16;
const METRICS_TOKEN = "benchmark-metrics-token";

// Thrown rather than exiting here, so that `finally` still stops the child processes.
class BenchmarkAborted extends Error {}
const fail = (message: string): never => {
  throw new BenchmarkAborted(message);
};

const percentile = (sorted: number[], fraction: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];

const round = (value: number, digits = 2) => Number(value.toFixed(digits));

// ---------------------------------------------------------------- Lua scripts

type ScriptCase = {
  name: string;
  lua: string;
  args: (i: number) => string[];
  capacityArgs: () => string[];
};

const SCRIPT_CASES: ScriptCase[] = [
  {
    name: "token_bucket",
    lua: tokenBucketLua,
    args: () => ["1000000000", "1000000", "1"],
    capacityArgs: () => ["1000", "0.001", "1"],
  },
  {
    name: "leaky_bucket",
    lua: leakyBucketLua,
    args: () => ["1000000000", "1000000", "1"],
    capacityArgs: () => ["1000", "0.001", "1"],
  },
  {
    name: "sliding_window",
    lua: slidingWindowLua,
    // A short window keeps the sorted set small: this measures the script, not memory.
    // These values are outside what the admin API accepts, and results.md says so.
    args: (i) => ["100", "1000000000", `bench-${i}`],
    capacityArgs: () => ["600000", "1000", crypto.randomUUID()],
  },
];

const benchScripts = async () => {
  const redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null });
  // A silent fallback here is how the old benchmark measured a JavaScript mock.
  await redis.connect().catch((err: Error) => fail(`Redis is unreachable at ${REDIS_URL}: ${err.message}`));
  const pong = await redis.ping();
  if (pong !== "PONG") fail("Redis did not answer PING");
  const version = /redis_version:(\S+)/.exec(await redis.info("server"))?.[1] ?? "unknown";

  const results = [];
  for (const scriptCase of SCRIPT_CASES) {
    redis.defineCommand(`bench_${scriptCase.name}`, { numberOfKeys: 1, lua: scriptCase.lua });
    const call = (key: string, args: string[]) =>
      (redis as unknown as Record<string, (k: string, ...a: string[]) => Promise<number[]>>)[
        `bench_${scriptCase.name}`
      ](key, ...args);

    for (const concurrency of CONCURRENCY) {
      await redis.flushdb();
      const latencies: number[] = [];
      let issued = 0;
      const started = performance.now();
      await Promise.all(
        Array.from({ length: concurrency }, async () => {
          while (issued < REDIS_OPS) {
            const i = issued++;
            const before = performance.now();
            await call(`bench:${scriptCase.name}`, scriptCase.args(i));
            latencies.push(performance.now() - before);
          }
        }),
      );
      const seconds = (performance.now() - started) / 1000;
      latencies.sort((a, b) => a - b);

      // Atomicity: calls racing over separate connections, as separate gateway nodes
      // would be. One connection would run them strictly in order and prove nothing.
      await redis.flushdb();
      const racers = await Promise.all(
        Array.from({ length: RACING_CONNECTIONS }, async () => {
          const client = new Redis(REDIS_URL, { maxRetriesPerRequest: 1 });
          client.defineCommand(`bench_${scriptCase.name}`, { numberOfKeys: 1, lua: scriptCase.lua });
          await client.ping();
          return client as unknown as Record<string, (k: string, ...a: string[]) => Promise<number[]>>;
        }),
      );
      const admitted = await Promise.all(
        Array.from({ length: 5_000 }, (_, i) =>
          racers[i % RACING_CONNECTIONS][`bench_${scriptCase.name}`](
            `limit:${scriptCase.name}`,
            ...scriptCase.capacityArgs(),
          ),
        ),
      );
      for (const racer of racers) (racer as unknown as Redis).disconnect();
      const allowed = admitted.reduce((sum, [ok]) => sum + ok, 0);
      if (allowed !== 1000) fail(`${scriptCase.name} admitted ${allowed} of a limit of 1000`);

      results.push({
        script: scriptCase.name,
        inFlight: concurrency,
        opsPerSecond: Math.round(latencies.length / seconds),
        p50Ms: round(percentile(latencies, 0.5)),
        p95Ms: round(percentile(latencies, 0.95)),
        p99Ms: round(percentile(latencies, 0.99)),
        admittedOfLimit: `${allowed}/1000`,
      });
      process.stdout.write(`  ${JSON.stringify(results.at(-1))}\n`);
    }
  }
  await redis.flushdb();
  redis.disconnect();
  return { version, results };
};

// ------------------------------------------------------------- HTTP end to end

const runK6 = (targetUrl: string, apiKey: string, vus: number) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "fluxgate-bench-"));
  const summary = path.join(dir, "summary.json");
  execFileSync(
    "k6",
    ["run", "--quiet", "--summary-export", summary, path.resolve("tests/load/gateway.k6.js")],
    {
      stdio: ["ignore", "ignore", "inherit"],
      env: { ...process.env, TARGET_URL: targetUrl, API_KEY: apiKey, VUS: String(vus), DURATION },
    },
  );
  const { metrics } = JSON.parse(readFileSync(summary, "utf-8"));
  const duration = metrics.http_req_duration;
  const failed = metrics.checks.fails ?? 0;
  if (failed > 0) fail(`${failed} checks failed for ${targetUrl} at ${vus} VUs`);
  return {
    vus,
    requestsPerSecond: Math.round(metrics.http_reqs.rate),
    p50Ms: round(duration["p(50)"]),
    p95Ms: round(duration["p(95)"]),
    p99Ms: round(duration["p(99)"]),
    requests: metrics.http_reqs.count as number,
  };
};

/** A number from a run that shed telemetry or skipped the limiter would mislead. */
const assertNothingDegraded = async (base: string) => {
  const res = await fetch(`${base}/metrics`, {
    headers: { Authorization: `Bearer ${METRICS_TOKEN}` },
  });
  if (!res.ok) fail(`/metrics returned ${res.status}`);
  const text = await res.text();
  const total = (name: string) =>
    text
      .split("\n")
      .filter((line) => line.startsWith(name))
      .reduce((sum, line) => sum + Number(line.split(" ").pop()), 0);
  for (const name of [
    "fluxgate_rate_limit_fail_open_total",
    "fluxgate_telemetry_dropped_total",
    "fluxgate_kafka_publish_failures_total",
  ]) {
    if (total(name) > 0) fail(`${name} is ${total(name)}: the gateway was degraded during the run`);
  }
};

const benchGateway = async () => {
  // In its own process, so that load on it does not take CPU from the gateway's event loop.
  const upstreamScript = `
    const http = require("node:http");
    const body = Buffer.alloc(1024, "x");
    const server = http.createServer((req, res) => res.end(body));
    server.keepAliveTimeout = 60000;
    server.listen({ port: 0, host: "127.0.0.1", backlog: 4096 }, () => console.log(server.address().port));
  `;
  const upstream = spawn(process.execPath, ["-e", upstreamScript], { stdio: ["ignore", "pipe", "inherit"] });
  const upstreamPort = await new Promise<number>((resolve) =>
    upstream.stdout.once("data", (chunk) => resolve(Number(String(chunk).trim()))),
  );
  const upstreamUrl = `http://127.0.0.1:${upstreamPort}`;

  const adminUrl = new URL(DATABASE_URL);
  const database = adminUrl.pathname.slice(1);
  adminUrl.pathname = "/postgres";
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  await admin`select 1`.catch((err: Error) => fail(`Postgres is unreachable: ${err.message}`));
  await admin.unsafe(`drop database if exists "${database}"`);
  await admin.unsafe(`create database "${database}"`);
  await admin.end();

  execFileSync(process.execPath, ["dist/db/migrate.js"], {
    env: { ...process.env, DATABASE_URL },
    stdio: "inherit",
  });

  // Production mode with production logging, written to a file as a container runtime
  // would. Everything a local .env could set is pinned, so it cannot change the result.
  const logFile = openSync(path.join(mkdtempSync(path.join(os.tmpdir(), "fluxgate-bench-log-")), "gateway.log"), "w");
  const gateway = spawn(process.execPath, ["dist/server.js"], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      LOG_LEVEL: "info",
      PORT: String(GATEWAY_PORT),
      DATABASE_URL,
      REDIS_URL,
      KAFKA_BROKER,
      KAFKA_TOPIC: "bench.traffic.logs",
      JWT_SECRET: "benchmark-jwt-secret-benchmark-jwt-secret",
      INTERNAL_ALERT_SECRET: "benchmark-internal-alert-secret",
      SECRETS_ENCRYPTION_KEY: "benchmark-encryption-key",
      METRICS_TOKEN,
      COOKIE_SECURE: "false",
      TRUST_PROXY: "false",
      ALLOW_PRIVATE_TARGETS: "true",
      FLUXGATE_DEMO_MODE: "true",
      OTEL_ENABLED: "false",
      SENTRY_DSN: "",
    },
    stdio: ["ignore", logFile, logFile],
  });
  // Otherwise a dead child leaves this script probing whatever else has the port.
  let gatewayExited = false;
  gateway.once("exit", () => {
    gatewayExited = true;
  });

  try {
    const base = `http://127.0.0.1:${GATEWAY_PORT}`;
    let ready: { status: string; checks: Record<string, string> } | undefined;
    for (let i = 0; i < 100; i++) {
      if (gatewayExited) fail("The gateway process exited during startup");
      await new Promise((resolve) => setTimeout(resolve, 200));
      try {
        const res = await fetch(`${base}/health/ready`);
        const body = (await res.json()) as { status: string; checks: Record<string, string> };
        if (body.status === "ok") {
          ready = body;
          break;
        }
      } catch {
        // Not listening yet.
      }
    }
    // Benchmarks of a degraded gateway would not measure the real path.
    if (!ready) fail("Gateway never reported ok: Postgres, Redis and Kafka must all be up");

    let cookie = "";
    const api = async (method: string, route: string, body: unknown) => {
      const res = await fetch(`${base}${route}`, {
        method,
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify(body),
      });
      cookie = res.headers.get("set-cookie")?.split(";")[0] ?? cookie;
      if (!res.ok) fail(`${method} ${route} returned ${res.status}`);
      return res.json() as Promise<Record<string, string>>;
    };
    const credentials = { email: "bench@example.com", password: "benchmark-password" };
    await api("POST", "/auth/signup", { tenantName: "Benchmark", ...credentials });
    await api("POST", "/auth/login", credentials);
    await api("POST", "/admin/routes", { pathPrefix: "/bench", targetUrl: upstreamUrl });
    // Limits high enough that this measures throughput, not rejection speed.
    await api("PUT", "/admin/rate-limit", {
      strategy: "token_bucket",
      capacity: 1_000_000,
      refillRate: 1_000_000,
      windowMs: 60_000,
    });
    const { apiKey } = await api("POST", "/keys", { name: "bench" });

    const direct = [];
    const viaGateway = [];
    for (const vus of CONCURRENCY) {
      direct.push(runK6(upstreamUrl, "", vus));
      process.stdout.write(`  direct  ${JSON.stringify(direct.at(-1))}\n`);
      viaGateway.push(runK6(`${base}/gateway/bench`, apiKey, vus));
      process.stdout.write(`  gateway ${JSON.stringify(viaGateway.at(-1))}\n`);
      // Telemetry flushes on a timer, so give the sinks a moment before judging them.
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      await assertNothingDegraded(base);
    }

    // Exact enforcement over real HTTP, across all the middleware.
    await api("PUT", "/admin/rate-limit", {
      strategy: "sliding_window",
      capacity: 500,
      refillRate: 1,
      windowMs: 600_000,
    });
    const statuses = await Promise.all(
      Array.from({ length: 2_000 }, async () => {
        const res = await fetch(`${base}/gateway/bench`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        await res.arrayBuffer();
        return res.status;
      }),
    );
    const served = statuses.filter((status) => status === 200).length;
    const limited = statuses.filter((status) => status === 429).length;
    if (served !== 500 || limited !== 1500) {
      fail(`Expected 500 served and 1500 limited, got ${served} and ${limited}`);
    }

    return { direct, viaGateway, enforcement: { sent: 2000, limit: 500, served, limited } };
  } finally {
    gateway.kill();
    upstream.kill();
  }
};

// ------------------------------------------------------------------- reporting

const table = (rows: Record<string, unknown>[]) => {
  const columns = Object.keys(rows[0]);
  return [
    `| ${columns.join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${columns.map((c) => row[c]).join(" | ")} |`),
  ].join("\n");
};

const main = async () => {
  // Built here so the numbers cannot describe stale output in dist/.
  process.stdout.write("Building\n");
  execFileSync(process.execPath, [path.resolve("node_modules/typescript/bin/tsc")], { stdio: "inherit" });

  process.stdout.write("Lua scripts against real Redis\n");
  const scripts = await benchScripts();
  process.stdout.write("HTTP end to end\n");
  const http = await benchGateway();

  const environment = {
    cpu: os.cpus()[0]?.model.trim(),
    logicalCores: os.cpus().length,
    memoryGb: round(os.totalmem() / 1024 ** 3, 1),
    os: `${os.type()} ${os.release()}`,
    node: process.version,
    redis: scripts.version,
    k6: execFileSync("k6", ["version"]).toString().split("\n")[0].trim(),
    gitCommit: execFileSync("git", ["rev-parse", "--short", "HEAD"]).toString().trim(),
    uncommittedChanges: execFileSync("git", ["status", "--porcelain", "--untracked-files=no"]).toString().trim().length > 0,
    date: new Date().toISOString(),
  };

  const out = path.resolve("docs/benchmarks");
  mkdirSync(out, { recursive: true });
  writeFileSync(
    path.join(out, "results.json"),
    `${JSON.stringify({ environment, scripts: scripts.results, http }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(out, "results.md"),
    `# Benchmark results

Generated by \`pnpm bench\` (scripts/run-benchmarks.ts). Do not edit by hand.

## Environment

${table([environment])}

The load generator (k6), the gateway and the upstream ran on the same machine, sharing
its CPU. Postgres, Redis and Redpanda ran in Docker Desktop on that machine. Treat these
as relative numbers for this setup, not as capacity figures for production hardware.

## Lua scripts, real Redis

${REDIS_OPS.toLocaleString("en-US")} calls per row over one connection, as the gateway does; "inFlight" is how many
are outstanding at once. The token and leaky bucket rows use a 1e9 capacity and the sliding window
rows a 100 ms window and 1e9 limit, so that calls are not rejected. The admin API does not accept
those values: they exist only to measure the scripts.

"admittedOfLimit" is an atomicity check: 5,000 calls racing over ${RACING_CONNECTIONS} connections against a limit of
1,000. The run aborts unless exactly 1,000 are admitted.

${table(scripts.results)}

## HTTP: direct to the upstream

Baseline: k6 straight to a Node upstream returning 1 KB. Each row is a 5s ramp plus ${DURATION} at the
stated number of virtual users, and the figures include the ramp.

${table(http.direct)}

## HTTP: through the gateway

The same upstream through API key auth, rate limiting, proxying and telemetry, in production mode
with info logging to a file, and Postgres, Redis and Kafka all connected. The run aborts if any
request does not return 200, if any response skipped the rate limiter, or if the gateway's metrics
show fail-open responses, dropped telemetry or failed Kafka publishes.

${table(http.viaGateway)}

## Rate limit enforcement over HTTP

${table([http.enforcement])}
`,
  );
  process.stdout.write(`Wrote ${out}\n`);
};

try {
  await main();
  process.exit(0);
} catch (err) {
  // A silent fallback here is how the old benchmark ended up measuring a JavaScript mock.
  process.stderr.write(`BENCHMARK ABORTED: ${(err as Error).message}\n`);
  process.exit(1);
}
