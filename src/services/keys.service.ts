import { db } from "../db/index.js";
import { apiKeys, tenants } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { generateApiKey } from "../utils/crypto.js";
import { AppError } from "../lib/AppError.js";
import { createChildLogger } from "../lib/logger.js";

const log = createChildLogger("keys-service");

export async function getKeysByTenantId(tenantId: string) {
  if (!tenantId) {
    throw AppError.badRequest("Missing tenantId", "MISSING_TENANT_ID");
  }

  const keys = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.tenantId, tenantId));

  return keys;
}

export async function createApiKey(tenantId: string): Promise<string> {
  if (!tenantId) {
    throw AppError.badRequest("Missing tenantId", "MISSING_TENANT_ID");
  }

  // Check if tenant exists
  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, tenantId));

  if (!tenant) {
    throw AppError.notFound("Tenant not found", "TENANT_NOT_FOUND");
  }

  const { rawKey, hash, hint } = generateApiKey();

  await db.insert(apiKeys).values({
    tenantId,
    keyHash: hash,
    hint,
  });

  log.info({ tenantId, hint }, "API key generated");
  return rawKey;
}
