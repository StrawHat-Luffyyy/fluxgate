import { Hono } from "hono";
import {
  dashBoardAuth,
  type DashboardEnv,
} from "../middleware/dashBoardAuth.js";
import { requiredRole } from "../middleware/rbac.js";
import { createGatewayRoute, getGatewayRoutes } from "../services/admin.service.js";

const adminRouter = new Hono<DashboardEnv>();
adminRouter.use("*", dashBoardAuth);

adminRouter.post("/routes", requiredRole(["admin"]), async (c) => {
  const tenantId = c.get("tenantId");
  const { pathPrefix, targetUrl } = await c.req.json();

  const newRoute = await createGatewayRoute({ tenantId, pathPrefix, targetUrl });
  return c.json({ success: true, route: newRoute }, 201);
});

adminRouter.get("/routes", requiredRole(["viewer"]), async (c) => {
  const tenantId = c.get("tenantId");
  const routes = await getGatewayRoutes(tenantId);
  return c.json({ success: true, routes });
});

export default adminRouter;
