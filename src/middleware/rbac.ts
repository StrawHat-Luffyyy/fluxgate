import type { MiddlewareHandler } from "hono";
import type { DashboardEnv } from "./dashBoardAuth.js";

export type Role = "admin" | "viewer";

const ROLE_RANK: Record<Role, number> = { viewer: 0, admin: 1 };

/** Allows the given role and every role above it. */
export const requiredRole = (minimum: Role): MiddlewareHandler<DashboardEnv> => {
  return async (c, next) => {
    const userRole = c.get("userRole");
    if (!userRole) {
      return c.json(
        { error: "Unauthorized", message: "User role context missing." },
        401,
      );
    }
    if (ROLE_RANK[userRole] < ROLE_RANK[minimum]) {
      return c.json(
        {
          error: "Forbidden",
          message: "You do not have permission to perform this action.",
        },
        403,
      );
    }
    await next();
  };
};
