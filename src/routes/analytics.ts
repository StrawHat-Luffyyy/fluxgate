import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../lib/AppError.js";
import { dashBoardAuth, type DashboardEnv } from "../middleware/dashBoardAuth.js";
import { requiredRole } from "../middleware/rbac.js";
import { getAnalyticsOverview } from "../services/analytics.service.js";

const rangeSchema = z.enum(["1h", "24h", "7d"]).default("24h");

const analyticsRouter = new Hono<DashboardEnv>();

analyticsRouter.use("*", dashBoardAuth);

analyticsRouter.get("/overview", requiredRole("viewer"), async (c) => {
  const range = rangeSchema.safeParse(c.req.query("range"));
  if (!range.success) throw AppError.badRequest("range must be 1h, 24h or 7d", "VALIDATION_ERROR");
  const overview = await getAnalyticsOverview(c.get("tenantId"), range.data);
  return c.json({ success: true, ...overview });
});

export default analyticsRouter;
