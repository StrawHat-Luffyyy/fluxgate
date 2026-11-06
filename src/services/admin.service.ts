import { and, asc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { gatewayRoutes } from "../db/schema.js";
import { AppError } from "../lib/AppError.js";
import { createChildLogger } from "../lib/logger.js";
import { assertPublicUrl } from "../lib/ssrf.js";
import { isUniqueViolation } from "../lib/validate.js";
import { routeCacheKey } from "../proxy/handler.js";
import { cacheDel } from "../redis/cache.js";

const log = createChildLogger("admin-service");

const conflict = (pathPrefix: string) =>
  AppError.conflict(`A route for ${pathPrefix} already exists`, "ROUTE_EXISTS");

export interface CreateRouteInput {
  tenantId: string;
  pathPrefix: string;
  targetUrl: string;
}

export async function createGatewayRoute(input: CreateRouteInput) {
  const { tenantId, pathPrefix, targetUrl } = input;
  await assertPublicUrl(targetUrl);

  try {
    const [route] = await db
      .insert(gatewayRoutes)
      .values({ tenantId, pathPrefix, targetUrl })
      .returning();
    await cacheDel(routeCacheKey(tenantId, pathPrefix));
    log.info({ tenantId, pathPrefix, targetUrl }, "Gateway route created");
    return route;
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict(pathPrefix);
    throw err;
  }
}

export const getGatewayRoutes = (tenantId: string) =>
  db
    .select()
    .from(gatewayRoutes)
    .where(eq(gatewayRoutes.tenantId, tenantId))
    .orderBy(asc(gatewayRoutes.pathPrefix));

export async function updateGatewayRoute(
  tenantId: string,
  routeId: string,
  changes: { pathPrefix?: string; targetUrl?: string },
) {
  if (changes.targetUrl) await assertPublicUrl(changes.targetUrl);

  const [existing] = await db
    .select({ pathPrefix: gatewayRoutes.pathPrefix })
    .from(gatewayRoutes)
    .where(and(eq(gatewayRoutes.id, routeId), eq(gatewayRoutes.tenantId, tenantId)))
    .limit(1);
  if (!existing) throw AppError.notFound("Route not found");

  try {
    const [route] = await db
      .update(gatewayRoutes)
      .set({ ...changes, updatedAt: new Date() })
      .where(and(eq(gatewayRoutes.id, routeId), eq(gatewayRoutes.tenantId, tenantId)))
      .returning();
    if (!route) throw AppError.notFound("Route not found");
    await cacheDel(
      routeCacheKey(tenantId, existing.pathPrefix),
      routeCacheKey(tenantId, route.pathPrefix),
    );
    return route;
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict(changes.pathPrefix ?? existing.pathPrefix);
    throw err;
  }
}

export async function deleteGatewayRoute(tenantId: string, routeId: string) {
  const [route] = await db
    .delete(gatewayRoutes)
    .where(and(eq(gatewayRoutes.id, routeId), eq(gatewayRoutes.tenantId, tenantId)))
    .returning({ pathPrefix: gatewayRoutes.pathPrefix });
  if (!route) throw AppError.notFound("Route not found");
  await cacheDel(routeCacheKey(tenantId, route.pathPrefix));
}
