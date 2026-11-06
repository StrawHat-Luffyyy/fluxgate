import { Hono } from "hono";
import { z } from "zod";
import { parseBody, parseId } from "../lib/validate.js";
import { dashBoardAuth, type DashboardEnv } from "../middleware/dashBoardAuth.js";
import { requiredRole } from "../middleware/rbac.js";
import {
  createApiKey,
  listKeys,
  revokeApiKey,
  rotateApiKey,
} from "../services/keys.service.js";

const createKeySchema = z.object({
  name: z.string().trim().min(1).max(80).default("Default"),
  expiresInDays: z.number().int().min(1).max(3650).optional(),
});

export const keysRouter = new Hono<DashboardEnv>();

// The tenant always comes from the session. A request body can never select it.
keysRouter.use("*", dashBoardAuth);

keysRouter.get("/", requiredRole("viewer"), async (c) => {
  return c.json({ keys: await listKeys(c.get("tenantId")) });
});

keysRouter.post("/", requiredRole("admin"), async (c) => {
  const input = await parseBody(c, createKeySchema);
  const { key, rawKey } = await createApiKey(c.get("tenantId"), input);
  return c.json(
    {
      key,
      apiKey: rawKey,
      message: "Store this securely, it will only be shown once.",
    },
    201,
  );
});

keysRouter.post("/:id/rotate", requiredRole("admin"), async (c) => {
  const { key, rawKey } = await rotateApiKey(
    c.get("tenantId"),
    parseId(c.req.param("id"), "API key"),
  );
  return c.json(
    {
      key,
      apiKey: rawKey,
      message: "Store this securely, it will only be shown once.",
    },
    201,
  );
});

keysRouter.delete("/:id", requiredRole("admin"), async (c) => {
  const key = await revokeApiKey(
    c.get("tenantId"),
    parseId(c.req.param("id"), "API key"),
  );
  return c.json({ key });
});
