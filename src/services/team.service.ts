import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { AppError } from "../lib/AppError.js";
import { createChildLogger } from "../lib/logger.js";
import { isUniqueViolation } from "../lib/validate.js";
import type { Role } from "../middleware/rbac.js";
import { hashPassword, normalizeEmail } from "./auth.service.js";

const log = createChildLogger("team-service");

const publicColumns = {
  id: users.id,
  email: users.email,
  role: users.role,
  createdAt: users.createdAt,
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Locks the tenant's admin rows, so two concurrent demotions cannot each see the
 * other admin still present and leave the tenant with none.
 */
const assertNotLastAdmin = async (tx: Tx, tenantId: string, userId: string) => {
  const admins = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.role, "admin")))
    .for("update");
  if (admins.length === 1 && admins[0].id === userId) {
    throw AppError.conflict("A tenant must keep at least one admin", "LAST_ADMIN");
  }
};

export const listMembers = (tenantId: string) =>
  db
    .select(publicColumns)
    .from(users)
    .where(eq(users.tenantId, tenantId))
    .orderBy(users.createdAt);

export async function createMember(
  tenantId: string,
  input: { email: string; password: string; role: Role },
) {
  const passwordHash = await hashPassword(input.password);
  try {
    const [member] = await db
      .insert(users)
      .values({
        tenantId,
        email: normalizeEmail(input.email),
        passwordHash,
        role: input.role,
      })
      .returning(publicColumns);
    log.info({ tenantId, userId: member.id, role: member.role }, "Team member added");
    return member;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw AppError.conflict("An account with this email already exists", "USER_EXISTS");
    }
    throw err;
  }
}

export async function updateMemberRole(tenantId: string, userId: string, role: Role) {
  return db.transaction(async (tx) => {
    if (role !== "admin") await assertNotLastAdmin(tx, tenantId, userId);
    const [member] = await tx
      .update(users)
      .set({ role })
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
      .returning(publicColumns);
    if (!member) throw AppError.notFound("Team member not found");
    return member;
  });
}

export async function removeMember(tenantId: string, userId: string) {
  await db.transaction(async (tx) => {
    await assertNotLastAdmin(tx, tenantId, userId);
    const removed = await tx
      .delete(users)
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
      .returning({ id: users.id });
    if (removed.length === 0) throw AppError.notFound("Team member not found");
  });
}
