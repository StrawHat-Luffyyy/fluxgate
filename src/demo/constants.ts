/**
 * Fixed values for the local demo only. They are public, in this repository, and
 * the seed refuses any database that is not local (see guard.ts).
 */
export const DEMO_TENANT_ID = "00000000-0000-4000-8000-00000000d340";
export const DEMO_API_KEY_ID = "00000000-0000-4000-8000-00000000d341";
export const DEMO_API_KEY = "fg_live_demo0000000000000000000000000000000000000000";
export const DEMO_ADMIN_EMAIL = "admin@fluxgate-demo.example.com";
export const DEMO_VIEWER_EMAIL = "viewer@fluxgate-demo.example.com";
export const DEMO_PASSWORD = "fluxgate-demo-password";
export const DEMO_WEBHOOK_SECRET = "whsec_fluxgate_demo_only";
export const DEMO_ROUTE_PREFIXES = ["/orders", "/users", "/catalog"];
