import { Hono } from "hono";
import { z } from "zod";
import { parseBody, parseId } from "../lib/validate.js";
import { dashBoardAuth, type DashboardEnv } from "../middleware/dashBoardAuth.js";
import { requiredRole } from "../middleware/rbac.js";
import {
  createGatewayRoute,
  deleteGatewayRoute,
  getGatewayRoutes,
  updateGatewayRoute,
} from "../services/admin.service.js";

// The proxy matches on the first path segment, so a multi-segment prefix could
// be saved but would never match any request.
const pathPrefix = z
  .string()
  .trim()
  .regex(/^\/?[A-Za-z0-9._~-]{1,64}\/?$/, "must be a single path segment, like /users")
  .transform((value) => `/${value.replace(/^\/|\/$/g, "")}`);

const targetUrl = z.url().max(2048);

const adminRouter = new Hono<DashboardEnv>();
adminRouter.use("*", dashBoardAuth);

adminRouter.post("/routes", requiredRole("admin"), async (c) => {
  const input = await parseBody(c, z.object({ pathPrefix, targetUrl }));
  const route = await createGatewayRoute({ tenantId: c.get("tenantId"), ...input });
  return c.json({ success: true, route }, 201);
});

adminRouter.get("/routes", requiredRole("viewer"), async (c) => {
  const routes = await getGatewayRoutes(c.get("tenantId"));
  return c.json({ success: true, routes });
});

adminRouter.patch("/routes/:id", requiredRole("admin"), async (c) => {
  const changes = await parseBody(
    c,
    z.object({ pathPrefix: pathPrefix.optional(), targetUrl: targetUrl.optional() }),
  );
  const route = await updateGatewayRoute(
    c.get("tenantId"),
    parseId(c.req.param("id"), "Route"),
    changes,
  );
  return c.json({ success: true, route });
});

adminRouter.delete("/routes/:id", requiredRole("admin"), async (c) => {
  await deleteGatewayRoute(c.get("tenantId"), parseId(c.req.param("id"), "Route"));
  return c.body(null, 204);
});

export default adminRouter;
