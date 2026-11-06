import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { apiKeys } from "../db/schema.js";
import { AppError } from "../lib/AppError.js";
import { createChildLogger } from "../lib/logger.js";
import { apiKeyCacheKey } from "../middleware/auth.js";
import { cacheDel } from "../redis/cache.js";
import { generateApiKey } from "../utils/crypto.js";

const log = createChildLogger("keys-service");

// keyHash is deliberately absent: it never leaves the database.
const publicColumns = {
  id: apiKeys.id,
  name: apiKeys.name,
  hint: apiKeys.hint,
  createdAt: apiKeys.createdAt,
  expiresAt: apiKeys.expiresAt,
  revokedAt: apiKeys.revokedAt,
};

export const listKeys = (tenantId: string) =>
  db
    .select(publicColumns)
    .from(apiKeys)
    .where(eq(apiKeys.tenantId, tenantId))
    .orderBy(desc(apiKeys.createdAt));

export interface CreateKeyInput {
  name: string;
  expiresInDays?: number;
}

const expiryFrom = (days?: number) =>
  days ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : null;

/** The raw key is returned once, here, and is not recoverable afterwards. */
export async function createApiKey(tenantId: string, input: CreateKeyInput) {
  const { rawKey, hash, hint } = generateApiKey();
  const [key] = await db
    .insert(apiKeys)
    .values({
      tenantId,
      name: input.name,
      keyHash: hash,
      hint,
      expiresAt: expiryFrom(input.expiresInDays),
    })
    .returning(publicColumns);

  log.info({ tenantId, keyId: key.id, hint }, "API key created");
  return { key, rawKey };
}

export async function revokeApiKey(tenantId: string, keyId: string) {
  const [key] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiKeys.id, keyId),
        eq(apiKeys.tenantId, tenantId),
        isNull(apiKeys.revokedAt),
      ),
    )
    .returning({ ...publicColumns, keyHash: apiKeys.keyHash });
  if (!key) throw AppError.notFound("Active API key not found");

  const { keyHash, ...publicKey } = key;
  await cacheDel(apiKeyCacheKey(keyHash));
  log.info({ tenantId, keyId }, "API key revoked");
  return publicKey;
}

/** Replaces a key atomically: the old one stops working as the new one appears. */
export async function rotateApiKey(tenantId: string, keyId: string) {
  const { rawKey, hash, hint } = generateApiKey();

  const { oldHash, key } = await db.transaction(async (tx) => {
    const [old] = await tx
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(apiKeys.id, keyId),
          eq(apiKeys.tenantId, tenantId),
          isNull(apiKeys.revokedAt),
        ),
      )
      .returning({ keyHash: apiKeys.keyHash, name: apiKeys.name, expiresAt: apiKeys.expiresAt });
    if (!old) throw AppError.notFound("Active API key not found");

    const [created] = await tx
      .insert(apiKeys)
      .values({
        tenantId,
        name: old.name,
        keyHash: hash,
        hint,
        expiresAt: old.expiresAt,
      })
      .returning(publicColumns);
    return { oldHash: old.keyHash, key: created };
  });

  await cacheDel(apiKeyCacheKey(oldHash));
  log.info({ tenantId, oldKeyId: keyId, keyId: key.id }, "API key rotated");
  return { key, rawKey };
}
