import { Hono } from "hono";
import { db } from "../db/index.js";
import { gatewayRoutes } from "../db/schema.js";
import { authMiddleware, type Env } from "../middleware/auth.js";
import { redis } from "../redis/client.js";

const adminRouter = new Hono<Env>();
adminRouter.use("*", authMiddleware);

adminRouter.post("/routes", async (c) => {
  const tenantId = c.get("tenantId");
  const { pathPrefix, targetUrl } = await c.req.json();

  if (!pathPrefix || !targetUrl) {
    return c.json({ error: "Missing pathPrefix or targetUrl " }, 400);
  }

  const [newRoute] = await db
    .insert(gatewayRoutes)
    .values({
      tenantId,
      pathPrefix,
      targetUrl,
    })
    .returning();

  const cacheKey = `fluxgate:route:${tenantId}:${pathPrefix}`;
  await redis.del(cacheKey);

  return c.json({ success: true, route: newRoute }, 201);
});

export default adminRouter;
