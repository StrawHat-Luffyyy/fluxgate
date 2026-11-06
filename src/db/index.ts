import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { env } from "../config/env.js";

const queryClient = postgres(env.DATABASE_URL, { max: 10 });

export const db = drizzle(queryClient, { schema: schema });

// A small separate pool, so heavy dashboard aggregates can never take the
// connections that API key auth and route lookups need on the request path.
const analyticsClient = postgres(env.DATABASE_URL, { max: 2 });
export const analyticsDb = drizzle(analyticsClient, { schema: schema });

export const closeDb = async () => {
  await Promise.all([queryClient.end({ timeout: 5 }), analyticsClient.end({ timeout: 5 })]);
};
