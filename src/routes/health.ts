import { Hono } from "hono";
import { getReadiness } from "../services/health.service.js";

const healthRouter = new Hono();

const liveness = () => ({
  status: "ok",
  timestamp: new Date().toISOString(),
  uptime: process.uptime(),
});

// Liveness says only that the process is responsive. It must not check
// dependencies, or a Redis outage would make an orchestrator restart every
// gateway instance.
healthRouter.get("/", (c) => c.json(liveness()));
healthRouter.get("/live", (c) => c.json(liveness()));

healthRouter.get("/ready", async (c) => {
  const { ready, ...report } = await getReadiness();
  return c.json(report, ready ? 200 : 503);
});

export default healthRouter;
