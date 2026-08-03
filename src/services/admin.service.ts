import { db } from "../db/index.js";
import { gatewayRoutes } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { redis } from "../redis/client.js";
import { AppError } from "../lib/AppError.js";
import { createChildLogger } from "../lib/logger.js";

const log = createChildLogger("admin-service");

export interface CreateRouteInput {
  tenantId: string;
  pathPrefix: string;
  targetUrl: string;
}

export async function createGatewayRoute(input: CreateRouteInput) {
  const { tenantId, pathPrefix, targetUrl } = input;

  if (!pathPrefix || !targetUrl) {
    throw AppError.badRequest("Missing pathPrefix or targetUrl", "MISSING_ROUTE_FIELDS");
  }

  let normalizedPathPrefix = pathPrefix.trim();
  if (!normalizedPathPrefix.startsWith("/")) {
    normalizedPathPrefix = `/${normalizedPathPrefix}`;
  }
  normalizedPathPrefix = normalizedPathPrefix.replace(/\/+$/, "");

  if (!normalizedPathPrefix || normalizedPathPrefix === "/") {
    throw AppError.badRequest("Invalid pathPrefix", "INVALID_PATH_PREFIX");
  }

  const [newRoute] = await db
    .insert(gatewayRoutes)
    .values({
      tenantId,
      pathPrefix: normalizedPathPrefix,
      targetUrl,
    })
    .returning();

  // Invalidate the route cache
  const cacheKey = `fluxgate:route:${tenantId}:${normalizedPathPrefix}`;
  await redis.del(cacheKey);

  log.info({ tenantId, pathPrefix: normalizedPathPrefix, targetUrl }, "Gateway route created");
  return newRoute;
}

export async function getGatewayRoutes(tenantId: string) {
  const routes = await db
    .select()
    .from(gatewayRoutes)
    .where(eq(gatewayRoutes.tenantId, tenantId));

  return routes;
}
