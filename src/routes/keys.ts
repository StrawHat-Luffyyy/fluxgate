import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { dashBoardAuth, type DashboardEnv } from "../middleware/dashBoardAuth.js";
import { getCookie } from "hono/cookie";
import { verify } from "hono/jwt";
import { env } from "../config/env.js";
import { db } from "../db/index.js";
import { apiKeys, tenants } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { generateApiKey } from "../utils/crypto.js";
import { rateLimiterMiddleware } from "../middleware/rateLimiter.js";

export const keysRouter = new Hono<DashboardEnv>();

keysRouter.get("/", dashBoardAuth, async (c) => {
  try {
    const tenantId = c.get("tenantId");
    if (!tenantId) {
      return c.json(
        {
          success: false,
          message: "Missing tenantId",
        },
        400,
      );
    }
    const keys = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.tenantId, tenantId));

    return c.json({
      success: true,
      message: "Fetched keys successfully",
      keys,
      apiKey: keys,
    });
  } catch (error) {
    console.error(error);
    return c.json(
      {
        success: false,
        message: "Failed to fetch keys",
      },
      500,
    );
  }
});

//Generate API key
keysRouter.post("/", async (c) => {
  try {
    let tenantId = c.get("tenantId");

    // Check for cookie session first (Dashboard user)
    const token = getCookie(c, "Fluxgate_session");
    if (token) {
      try {
        const decodedPayload = await verify(token, env.JWT_SECRET, {
          alg: "HS256",
        });
        tenantId = decodedPayload.tenantId as string;
      } catch (err) {
        return c.json(
          {
            success: false,
            message: "Invalid session cookie",
          },
          401,
        );
      }
    }

    // Fallback to request body tenantId (for unauthenticated Onboarding calls)
    if (!tenantId) {
      try {
        const body = await c.req.json();
        tenantId = body.tenantId;
      } catch (e) {
        // No body or parsing failed
      }
    }

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
keysRouter.get("/protected", authMiddleware, rateLimiterMiddleware(), (c) => {
  return c.json({
    tenantId: c.get("tenantId"),
    message: "Authentication successful",
  });
});
