import { Hono } from "hono";
import { dashBoardAuth } from "../middleware/dashBoardAuth.js";
import type { Env } from "../middleware/auth.js";

const analyticsRouter = new Hono<Env>();

analyticsRouter.use("*", dashBoardAuth);

analyticsRouter.get("/overview", async (c) => {
  const tenatId = c.get("tenantId");

  const now = new Date();
  const timeSeries = [];
  let totalRequests = 0;
  let totalAnomalies = 0;

  for (let i = 24; i >= 0; i--) {
    const timestamp = new Date(now.getTime() - i * 60 * 60 * 1000);

    const baseTraffic = Math.floor(Math.abs(Math.sin(i / 3)) * 5000) + 500;

    const isAnomaly = Math.random() > 0.9;
    const anomalies = isAnomaly ? Math.floor(Math.random() * 5) + 1 : 0;

    totalRequests += baseTraffic;
    totalAnomalies += anomalies;

    timeSeries.push({
      time: `${timestamp.getHours()}:00`,
      requests: baseTraffic,
      anomalies: anomalies,
    });
  }
  return c.json({
    success: true,
    summary: {
      totalRequests,
      totalAnomalies,
      avgLatencyMs: 42, // Mocked
    },
    timeSeries,
  });
});

export default analyticsRouter;