import type { Context } from "hono";
import { z } from "zod";
import { AppError } from "./AppError.js";

/** Parses a JSON body against a schema, turning failures into a 400. */
export const parseBody = async <T extends z.ZodType>(
  c: Context,
  schema: T,
): Promise<z.output<T>> => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw AppError.badRequest("Request body must be valid JSON", "INVALID_JSON");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const [issue] = result.error.issues;
    const where = issue.path.join(".");
    throw AppError.badRequest(
      where ? `${where}: ${issue.message}` : issue.message,
      "VALIDATION_ERROR",
    );
  }
  return result.data;
};

const uuid = z.uuid();

/**
 * A malformed id cannot match any row, so it gets the same 404 as a missing one.
 * Without this, Postgres raises a cast error and the client sees a 500.
 */
export const parseId = (value: string | undefined, resource: string): string => {
  const result = uuid.safeParse(value);
  if (!result.success) throw AppError.notFound(`${resource} not found`);
  return result.data;
};

export const isUniqueViolation = (err: unknown): boolean => {
  let current = err as { code?: string; cause?: unknown } | undefined;
  while (current) {
    if (current.code === "23505") return true;
    current = current.cause as typeof current;
  }
  return false;
};
