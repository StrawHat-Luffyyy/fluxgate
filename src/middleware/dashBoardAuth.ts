import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { verify } from "hono/jwt";
import { env } from "../config/env.js";
import type { Env } from "./auth.js";

export const dashBoardAuth = createMiddleware<Env>(async (c, next) => {
  const token = getCookie(c, "Fluxgate_session");
  if (!token) {
    return c.json({ error: "Unauthorized", message: "No active session" }, 401);
  }
  try {
    const decodedPayload = await verify(token, env.JWT_SECRET, {
      alg: "HS256",
    });

    c.set("tenantId", decodedPayload.tenantId as string);
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
