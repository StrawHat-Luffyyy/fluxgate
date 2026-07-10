import type { MiddlewareHandler } from "hono";
import type { DashboardEnv } from "./dashBoardAuth.js";

type Role = "admin" | "viewer";

export const requiredRole = (
  allowedRoles: Role[],
): MiddlewareHandler<DashboardEnv> => {
  return async (c, next) => {
    const userRole = c.get("userRole");
    if (!userRole || !allowedRoles.includes(userRole)) {
      return c.json(
        { error: "Unauthorized", message: "User role context missing." },
        401,
      );
    }
    if (!allowedRoles.includes(userRole)) {
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
