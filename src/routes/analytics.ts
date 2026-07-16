import { Hono } from "hono";
import { dashBoardAuth } from "../middleware/dashBoardAuth.js";
import type { Env } from "../middleware/auth.js";
import { getAnalyticsOverview } from "../services/analytics.service.js";

const analyticsRouter = new Hono<Env>();

analyticsRouter.use("*", dashBoardAuth);

analyticsRouter.get("/overview", async (c) => {
  const tenantId = c.get("tenantId");
  const overview = await getAnalyticsOverview(tenantId);
  return c.json({ success: true, ...overview });
});

export default analyticsRouter;