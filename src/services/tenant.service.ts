import { db } from "../db/index.js";
import { tenants } from "../db/schema.js";
import { AppError } from "../lib/AppError.js";
import { createChildLogger } from "../lib/logger.js";

const log = createChildLogger("tenant-service");

export interface CreateTenantInput {
  name: string;
  plan: string;
}

export async function createTenant(input: CreateTenantInput) {
  const { name, plan } = input;

  if (!name || !plan) {
    throw AppError.badRequest("Missing required fields: name and plan", "MISSING_FIELDS");
  }

  const [tenant] = await db.insert(tenants).values({ name, plan }).returning();

  log.info({ tenantId: tenant.id, name, plan }, "Tenant created");
  return tenant;
}
