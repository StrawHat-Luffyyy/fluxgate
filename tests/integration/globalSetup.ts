import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "postgres"]);

export default async function setup() {
  const url = new URL(
    process.env.TEST_DATABASE_URL ??
      "postgresql://fluxgate:fluxgate@localhost:5432/fluxgate_test",
  );
  const database = url.pathname.slice(1);

  // These tests delete data. Never run them against anything else.
  if (!LOCAL_HOSTS.has(url.hostname) || !database.endsWith("_test")) {
    throw new Error(
      `Refusing to run integration tests against ${url.hostname}/${database}: ` +
        "the database must be local and its name must end in _test",
    );
  }

  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  const [existing] = await admin`select 1 from pg_database where datname = ${database}`;
  if (!existing) await admin.unsafe(`create database "${database}"`);
  await admin.end();

  const client = postgres(url.toString(), { max: 1, onnotice: () => {} });
  await migrate(drizzle(client), {
    migrationsFolder: path.resolve(process.cwd(), "drizzle"),
  });
  await client.end();
}
