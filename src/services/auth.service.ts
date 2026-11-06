import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { sign } from "hono/jwt";
import { env } from "../config/env.js";
import { db } from "../db/index.js";
import { tenants, users } from "../db/schema.js";
import { AppError } from "../lib/AppError.js";
import { createChildLogger } from "../lib/logger.js";
import { isUniqueViolation } from "../lib/validate.js";

const log = createChildLogger("auth-service");

const BCRYPT_ROUNDS = 10;
const SESSION_SECONDS = 60 * 60 * 24;

// Compared against when the email is unknown, so that a missing user takes as
// long as a wrong password and the login endpoint cannot be used to find accounts.
const DUMMY_HASH = bcrypt.hashSync("fluxgate-timing-equaliser", BCRYPT_ROUNDS);

export const hashPassword = (password: string) => bcrypt.hash(password, BCRYPT_ROUNDS);

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export interface SignupInput {
  tenantName: string;
  email: string;
  password: string;
}

/**
 * Creates a tenant and its first admin atomically. This is the only
 * unauthenticated way to create a user, and it can only create a new tenant:
 * joining an existing tenant requires an admin of that tenant (see team.service).
 */
export async function signup(input: SignupInput) {
  const email = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password);

  try {
    const user = await db.transaction(async (tx) => {
      const [tenant] = await tx
        .insert(tenants)
        .values({ name: input.tenantName.trim() })
        .returning({ id: tenants.id });
      const [created] = await tx
        .insert(users)
        .values({ email, passwordHash, tenantId: tenant.id, role: "admin" })
        .returning({
          id: users.id,
          email: users.email,
          tenantId: users.tenantId,
          role: users.role,
          createdAt: users.createdAt,
        });
      return created;
    });
    log.info({ userId: user.id, tenantId: user.tenantId }, "Tenant and admin created");
    return user;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw AppError.conflict("An account with this email already exists", "USER_EXISTS");
    }
    throw err;
  }
}

export interface LoginInput {
  email: string;
  password: string;
}

export async function loginUser(input: LoginInput): Promise<{ token: string }> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizeEmail(input.email)))
    .limit(1);

  const isValid = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !isValid) {
    throw AppError.unauthorized("Invalid credentials", "INVALID_CREDENTIALS");
  }

  const token = await sign(
    {
      userId: user.id,
      exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
    },
    env.JWT_SECRET,
  );

  log.info({ userId: user.id }, "User logged in");
  return { token };
}

export const SESSION_MAX_AGE_SECONDS = SESSION_SECONDS;

export async function getProfile(userId: string) {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      tenantId: users.tenantId,
      tenantName: tenants.name,
      plan: tenants.plan,
    })
    .from(users)
    .innerJoin(tenants, eq(users.tenantId, tenants.id))
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) throw AppError.notFound("User not found");
  return row;
}
