# Architectural Decisions Record (ADR)

## Day 1

- **Decision:** Use ES Modules (`type: "module"`) over CommonJS.
  - **Rationale:** Aligns with modern JavaScript standards and is required for native edge deployments.
- **Decision:** Use Hono over Express.
  - **Rationale:** Express ties us to Node.js APIs. Hono's Web Standard implementation ensures portability to Cloudflare Workers or Deno without rewriting business logic.
- **Decision:** Separate `app.ts` from `server.ts`.
  - **Rationale:** Allows for network-independent unit testing.
