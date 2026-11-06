import { createMiddleware } from "hono/factory";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { apiKeys } from "../db/schema.js";
import { hashKey } from "../utils/crypto.js";
import { cacheGet, cacheSet } from "../redis/cache.js";
import { AppError } from "../lib/AppError.js";

export type Env = {
  Variables: {
    tenantId: string;
    apiKeyId: string;
    rateLimited?: boolean;
    upstreamCalled?: boolean;
    requestBytes?: number;
    traceCarrier?: Record<string, string>;
    requestId: string;
  };
};

interface CachedKey {
  id: string;
  tenantId: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

const KEY_CACHE_TTL_SECONDS = 60;
export const apiKeyCacheKey = (hash: string) => `fluxgate:apikey:${hash}`;

const unauthorized = (message: string) => ({ error: "Unauthorized", message });

const lookupKey = async (hash: string): Promise<CachedKey | null> => {
  const cached = await cacheGet(apiKeyCacheKey(hash));
  if (cached) return JSON.parse(cached) as CachedKey;

  let record;
  try {
    [record] = await db
      .select({
        id: apiKeys.id,
        tenantId: apiKeys.tenantId,
        expiresAt: apiKeys.expiresAt,
        revokedAt: apiKeys.revokedAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, hash))
      .limit(1);
  } catch {
    // Authentication fails closed: no database and no cache means no access.
    throw AppError.serviceUnavailable("Authentication is temporarily unavailable", "AUTH_UNAVAILABLE");
  }
  if (!record) return null;

  const entry: CachedKey = {
    id: record.id,
    tenantId: record.tenantId,
    expiresAt: record.expiresAt?.toISOString() ?? null,
    revokedAt: record.revokedAt?.toISOString() ?? null,
  };
  await cacheSet(apiKeyCacheKey(hash), JSON.stringify(entry), KEY_CACHE_TTL_SECONDS);
  return entry;
};

export const authMiddleware = createMiddleware<Env>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json(unauthorized("Missing or invalid Authorization header"), 401);
  }

  const key = await lookupKey(hashKey(authHeader.slice("Bearer ".length).trim()));
  if (!key || key.revokedAt) {
    return c.json(unauthorized("Invalid API key"), 401);
  }
  if (key.expiresAt && new Date() > new Date(key.expiresAt)) {
    return c.json(unauthorized("API key has expired"), 401);
  }

  c.set("tenantId", key.tenantId);
  c.set("apiKeyId", key.id);
  await next();
});
