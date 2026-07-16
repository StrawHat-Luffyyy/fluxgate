import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { dashBoardAuth, type DashboardEnv } from "../middleware/dashBoardAuth.js";
import { getCookie } from "hono/cookie";
import { verify } from "hono/jwt";
import { env } from "../config/env.js";
import { rateLimiterMiddleware } from "../middleware/rateLimiter.js";
import { getKeysByTenantId, createApiKey } from "../services/keys.service.js";

export const keysRouter = new Hono<DashboardEnv>();

keysRouter.get("/", dashBoardAuth, async (c) => {
  const tenantId = c.get("tenantId");
  const keys = await getKeysByTenantId(tenantId);

  return c.json({
    success: true,
    message: "Fetched keys successfully",
    keys,
    apiKey: keys,
  });
});

//Generate API key
keysRouter.post("/", async (c) => {
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

  const rawKey = await createApiKey(tenantId);
  return c.json(
    {
      apiKey: rawKey,
      message: "Store this securely, it will only be shown once.",
    },
    201,
  );
});

// Protected test route
keysRouter.get("/protected", authMiddleware, rateLimiterMiddleware(), (c) => {
  return c.json({
    tenantId: c.get("tenantId"),
    message: "Authentication successful",
  });
});
