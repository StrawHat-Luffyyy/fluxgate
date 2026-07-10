import { Hono } from "hono";
import { db } from "../db/index.js";
import { gatewayRoutes } from "../db/schema.js";
import { authMiddleware, type Env } from "../middleware/auth.js";
import { redis } from "../redis/client.js";
import { requiredRole } from "../middleware/rbac.js";
import { eq } from "drizzle-orm";

const adminRouter = new Hono<Env>();
adminRouter.use("*", authMiddleware);

adminRouter.post("/routes", requiredRole(["admin"]), async (c) => {
  const tenantId = c.get("tenantId");
  const { pathPrefix, targetUrl } = await c.req.json();

  if (!pathPrefix || !targetUrl) {
    return c.json({ error: "Missing pathPrefix or targetUrl " }, 400);
  }

  let normalizedPathPrefix = pathPrefix.trim();
  if (!normalizedPathPrefix.startsWith("/")) {
    normalizedPathPrefix = `/${normalizedPathPrefix}`;
  }
  normalizedPathPrefix = normalizedPathPrefix.replace(/\/+$/, "");
  if (!normalizedPathPrefix || normalizedPathPrefix === "/") {
    return c.json({ error: "Invalid pathPrefix" }, 400);
  }

  const [newRoute] = await db
    .insert(gatewayRoutes)
    .values({
      tenantId,
      pathPrefix: normalizedPathPrefix,
      targetUrl,
    })
    .returning();

  const cacheKey = `fluxgate:route:${tenantId}:${normalizedPathPrefix}`;
  await redis.del(cacheKey);

  return c.json({ success: true, route: newRoute }, 201);
});

adminRouter.get("/routes", requiredRole(["viewer"]), async (c) => {
  const tenantId = c.get("tenantId");
  const routes = await db
    .select()
    .from(gatewayRoutes)
    .where(eq(gatewayRoutes.tenantId, tenantId));
  return c.json({ success: true, routes });
});
export default adminRouter;
