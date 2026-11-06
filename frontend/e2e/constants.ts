// Shared by playwright.config.ts, which starts the gateway with these values, and the
// tests, which talk to that gateway and its database directly. All of it is local and
// made up for this suite; none of it protects anything.

export const GATEWAY_PORT = 3005;
export const FRONTEND_PORT = 3006;
export const GATEWAY_URL = `http://localhost:${GATEWAY_PORT}`;
export const FRONTEND_URL = `http://localhost:${FRONTEND_PORT}`;

export const DATABASE_URL = "postgresql://fluxgate:fluxgate@localhost:5432/fluxgate_ui_test";
export const REDIS_URL = "redis://localhost:6379/1";
export const INTERNAL_ALERT_SECRET = "e2e-only-internal-alert-secret";
