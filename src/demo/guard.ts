const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The seed publishes a known password, so it must never reach a real database.
 * "postgres" is the compose service name, but also a common name for a production
 * host, so it counts as local only with the demo flag that compose sets. A comma
 * means several hosts, which postgres.js accepts and URL parsing does not separate.
 */
export const assertLocalDatabase = (
  databaseUrl: string,
  demoMode = process.env.FLUXGATE_DEMO_MODE === "true",
) => {
  const { hostname } = new URL(databaseUrl);
  const local = LOCAL_HOSTS.has(hostname) || (demoMode && hostname === "postgres");
  if (!local || databaseUrl.includes(",")) {
    throw new Error(
      `Refusing to seed a non-local database (host "${hostname}"). Set DATABASE_URL to a local one.`,
    );
  }
};
