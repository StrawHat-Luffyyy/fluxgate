import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { verify } from "hono/jwt";
import { eq } from "drizzle-orm";
import { env } from "../config/env.js";
import { users } from "../db/schema.js";
import { db } from "../db/index.js";

export type DashboardEnv = {
  Variables: {
    tenantId: string;
    userId: string;
    userRole: "admin" | "viewer";
    requestId: string;
  };
};

export const SESSION_COOKIE = "Fluxgate_session";

export const dashBoardAuth = createMiddleware<DashboardEnv>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) {
    return c.json({ error: "Unauthorized", message: "No active session" }, 401);
  }

  let userId: string;
  try {
    const payload = await verify(token, env.JWT_SECRET, { alg: "HS256" });
    userId = payload.userId as string;
  } catch {
    return c.json(
      { error: "Unauthorized", message: "Invalid or expired session" },
      401,
    );
  }

  // Role and tenant come from the database rather than the token, so a demotion
  // or removal applies on the next request instead of when the token expires.
  const [user] = await db
    .select({ role: users.role, tenantId: users.tenantId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) {
    return c.json(
      { error: "Unauthorized", message: "User no longer exists" },
      401,
    );
  }

  c.set("tenantId", user.tenantId);
  c.set("userId", userId);
  c.set("userRole", user.role);
  await next();
});
