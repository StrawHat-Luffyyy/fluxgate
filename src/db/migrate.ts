import { fileURLToPath } from "node:url";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import "dotenv/config";

// Run with `pnpm db:migrate`, or `node dist/db/migrate.js` inside the image.
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(here, "../../drizzle");

// Reads DATABASE_URL directly: migrating needs no application secrets.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const client = postgres(databaseUrl, { max: 1, onnotice: () => {} });
await migrate(drizzle(client), { migrationsFolder });
await client.end();

process.stdout.write("Migrations applied\n");
