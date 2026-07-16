import { db } from "../db/index.js";
import { users, tenants } from "../db/schema.js";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { sign } from "hono/jwt";
import { env } from "../config/env.js";
import { AppError } from "../lib/AppError.js";
import { createChildLogger } from "../lib/logger.js";

const log = createChildLogger("auth-service");

export interface RegisterInput {
  email: string;
  password: string;
  tenantId: string;
  role?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterResult {
  id: string;
  email: string;
  tenantId: string;
  role: string;
  createdAt: Date;
}

export interface LoginResult {
  token: string;
  secure: boolean;
}

export async function registerUser(input: RegisterInput): Promise<RegisterResult> {
  const { email, password, tenantId, role } = input;

  if (!email || !password || !tenantId) {
    throw AppError.badRequest("Email, password and tenantId required", "MISSING_FIELDS");
  }

  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!tenant) {
    throw AppError.notFound("Tenant not found", "TENANT_NOT_FOUND");
  }

  const [existingUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existingUser) {
    throw AppError.conflict("User already exists", "USER_EXISTS");
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

  log.info({ userId: newUser.id, tenantId }, "User registered successfully");
  return newUser;
}

export async function loginUser(input: LoginInput): Promise<LoginResult> {
  const { email, password } = input;

  if (!email || !password) {
    throw AppError.badRequest("Email and password required", "MISSING_CREDENTIALS");
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!user) {
    throw AppError.unauthorized("Invalid credentials", "INVALID_CREDENTIALS");
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    throw AppError.unauthorized("Invalid credentials", "INVALID_CREDENTIALS");
  }

  const payload = {
    userId: user.id,
    tenantId: user.tenantId,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24, // 1 day expiration
  };

  const token = await sign(payload, env.JWT_SECRET);

  log.info({ userId: user.id }, "User logged in");
  return {
    token,
    secure: env.NODE_ENV === "production",
  };
}
