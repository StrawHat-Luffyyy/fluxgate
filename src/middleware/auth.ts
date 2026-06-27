import { createMiddleware } from "hono/factory";
import { db } from "../db/index.js";
import { apiKeys } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { hashKey } from "../utils/crypto.js";

// 1. Define custom environment variables for Hono's Context.
// This allows type-safe access to c.get('tenantId') downstream.

export type Env = {
  Variables: {
    tenantId: string;
  };
};

export const authMiddleware = createMiddleware<Env>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json(
      {
        error: "Unauthorized",
        message: "Missing or invalid Authorization header",
      },
      401,
    );
  }
  const rawKey = authHeader.split(" ")[1];
  const hashedKey = hashKey(rawKey);

  const [keyRecord] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, hashedKey));
  if (!keyRecord) {
    return c.json(
      {
        error: "Unauthorized",
        message: "Invalid API key",
      },
      401,
    );
  }
  if (keyRecord.expiresAt && new Date() > keyRecord.expiresAt) {
    return c.json(
      {
        error: "Unauthorized",
        message: "API key has expired",
      },
      401,
    );
  }
  c.set("tenantId", keyRecord.tenantId);
  await next();
});
