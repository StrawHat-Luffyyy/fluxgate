import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { sign } from "hono/jwt";
import bcrypt from "bcryptjs";
import { db } from "../db/index.js";
import { users, tenants } from "../db/schema.js";
import { env } from "../config/env.js";
import { eq } from "drizzle-orm";

const authRouter = new Hono();

authRouter.post("/register", async (c) => {
  const { email, password, tenantId, role } = await c.req.json();

  if (!email || !password || !tenantId) {
    return c.json({ error: "Email, password and tenantId required" }, 400);
  }

  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!tenant) {
    return c.json({ error: "Tenant not found" }, 404);
  }

  const [existingUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existingUser) {
    return c.json({ error: "User already exists" }, 409);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const [newUser] = await db
    .insert(users)
    .values({
      email,
      passwordHash,
      tenantId,
      role: role === "admin" ? "admin" : "viewer",
    })
    .returning({
      id: users.id,
      email: users.email,
      tenantId: users.tenantId,
      role: users.role,
      createdAt: users.createdAt,
    });

  return c.json({ success: true, user: newUser }, 201);
});

authRouter.post("/login", async (c) => {
  const { email, password } = await c.req.json();

  if (!email || !password) {
    return c.json({ error: "Email and password required" }, 400);
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!user) {
    return c.json({ error: "Invalid credentials" }, 401);
  }
  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  const payload = {
    userId: user.id,
    tenantId: user.tenantId,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24, // 1 day expiration
  };
  const token = await sign(payload, env.JWT_SECRET);

  setCookie(c, "Fluxgate_session", token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 60 * 60 * 24, // 1 day in seconds
    path: "/",
  });
  return c.json({ message: "Login successful" }, 200);
});

authRouter.post("/logout", async (c) => {
  deleteCookie(c, "Fluxgate_session", {
    path: "/",
  });
  return c.json({ success: true, message: "Logged out" });
});

export default authRouter;
