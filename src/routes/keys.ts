import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { db } from "../db/index.js";
import { apiKeys, tenants } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { generateApiKey } from "../utils/crypto.js";

export const keysRouter = new Hono();

//Generate API key
keysRouter.post("/", async (c) => {
  try {
    const id = await c.req.json();
    const { tenantId } = id;
    if (!tenantId) {
      return c.json(
        {
          success: false,
          message: "Missing tenantId",
        },
        400,
      );
    }
    // Check if tenant exists
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    if (!tenant) {
      return c.json(
        {
          success: false,
          message: "Tenant not found",
        },
        404,
      );
    }
    const { rawKey, hash, hint } = generateApiKey();
    // Save the API key to the database
    await db.insert(apiKeys).values({
      tenantId,
      keyHash: hash,
      hint,
    });
    return c.json(
      {
        apiKey: rawKey,
        message: "Store this securely, it will only be shown once.",
      },
      201,
    );
  } catch (error) {
    console.error(error);
    return c.json(
      {
        success: false,
        message: "Failed to generate API key",
      },
      500,
    );
  }
});

// Protected test route
keysRouter.get("/protected", authMiddleware, (c) => {
  return c.json({
    tenantId: c.get("tenantId"),
    message: "Authentication successful",
  });
});