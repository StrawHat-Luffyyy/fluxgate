import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { verify } from "hono/jwt";
import { env } from "../config/env.js";
import { users } from "../db/schema.js";
import { db } from "../db/index.js";
import { eq } from "drizzle-orm";
import type { Env } from "./auth.js";

export type DashboardEnv = {
  Variables: {
    tenantId: string;
    userId: string;
    userRole: "admin" | "viewer";
  };
};

export const dashBoardAuth = createMiddleware<DashboardEnv>(async (c, next) => {
  const token = getCookie(c, "Fluxgate_session");
  if (!token) {
    return c.json({ error: "Unauthorized", message: "No active session" }, 401);
  }
  try {
    const decodedPayload = await verify(token, env.JWT_SECRET, {
      alg: "HS256",
    });
    const userId = decodedPayload.userId as string;
    const [user] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) {
      return c.json(
        { error: "Unauthorized", message: "User no longer exists" },
        401,
      );
    }
    c.set("tenantId", decodedPayload.tenantId as string);
    c.set("userId", userId);
    c.set("userRole", user.role);
    await next();
  } catch (err) {
    return c.json(
      {
        error: "Unauthorized",
        message: "Invalid or expired session",
      },
      401,
    );
  }
});
