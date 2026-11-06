import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { provisionTenant, startGateway, waitFor, type RunningProcess } from "./support.js";

// The real server process with a dependency genuinely unreachable from the start.

const PORT = 3102;
const BASE_URL = `http://127.0.0.1:${PORT}`;

const ready = async () => {
  const res = await fetch(`${BASE_URL}/health/ready`);
  return { status: res.status, body: (await res.json()) as { status: string; checks: Record<string, string> } };
};

describe("the running gateway with a dependency down", () => {
  let upstream: Server;
  let upstreamUrl: string;
  let gateway: RunningProcess | undefined;

  beforeAll(async () => {
    upstream = createServer((req, res) => {
      if (req.url?.startsWith("/slow")) setTimeout(() => res.end("finished"), 1_500);
      else res.end("served");
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await gateway?.stop();
    gateway = undefined;
  });

  afterAll(() => {
    upstream.closeAllConnections();
    upstream.close();
  });

  const startAndWait = async (env: NodeJS.ProcessEnv) => {
    gateway = startGateway(PORT, env);
    await waitFor("gateway to listen", async () => (await fetch(`${BASE_URL}/health/live`)).ok);
  };

  it("starts and serves traffic with Kafka unreachable, reporting degraded", async () => {
    await startAndWait({ KAFKA_BROKER: "127.0.0.1:59092" });

    const { api, apiKey } = await provisionTenant(BASE_URL);
    await api.request("POST", "/admin/routes", { pathPrefix: "/svc", targetUrl: upstreamUrl });

    const res = await fetch(`${BASE_URL}/gateway/svc`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("served");

    const { status, body } = await ready();
    expect(status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.checks.kafka).toBe("down");
    expect(body.checks.postgres).toBe("up");
  });

  it("starts and serves traffic with Redis unreachable, failing open quickly", async () => {
    await startAndWait({ REDIS_URL: "redis://127.0.0.1:59379" });

    const { api, apiKey } = await provisionTenant(BASE_URL);
    await api.request("POST", "/admin/routes", { pathPrefix: "/svc", targetUrl: upstreamUrl });

    const started = Date.now();
    const res = await fetch(`${BASE_URL}/gateway/svc`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const elapsed = Date.now() - started;

    expect(res.status).toBe(200);
    expect(res.headers.get("x-ratelimit-fallback")).toBe("fail-open");
    expect(elapsed).toBeLessThan(1_000); // An outage must not add seconds per request.

    const { status, body } = await ready();
    expect(status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.checks.redis).toBe("down");
  });

  it("is not ready, and fails API key auth closed, with Postgres unreachable", async () => {
    await startAndWait({
      DATABASE_URL: "postgresql://fluxgate:fluxgate@127.0.0.1:59432/fluxgate_test",
    });

    const { status, body } = await ready();
    expect(status).toBe(503);
    expect(body.checks.postgres).toBe("down");

    const res = await fetch(`${BASE_URL}/gateway/svc`, {
      headers: { Authorization: "Bearer fg_live_anything" },
    });
    expect(res.status).toBe(503);
    // Liveness stays up, so an orchestrator does not restart it for a database outage.
    expect((await fetch(`${BASE_URL}/health/live`)).status).toBe(200);
  });

  // Windows has no SIGTERM: Node's kill() ends the process immediately there. CI runs on Linux.
  it.skipIf(process.platform === "win32")(
    "finishes an in-flight request on SIGTERM, then exits cleanly",
    async () => {
      await startAndWait({});
      const { api, apiKey } = await provisionTenant(BASE_URL);
      await api.request("POST", "/admin/routes", { pathPrefix: "/svc", targetUrl: upstreamUrl });

      const inFlight = fetch(`${BASE_URL}/gateway/svc/slow`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      await new Promise((resolve) => setTimeout(resolve, 300));

      const exit = gateway!.stop("SIGTERM");

      const res = await inFlight;
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("finished");
      expect(await exit).toBe(0);
      gateway = undefined;
    },
  );
});
