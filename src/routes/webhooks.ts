import { Hono } from "hono";
import { z } from "zod";
import { parseBody, parseId } from "../lib/validate.js";
import { dashBoardAuth, type DashboardEnv } from "../middleware/dashBoardAuth.js";
import { requiredRole } from "../middleware/rbac.js";
import {
  createEndpoint,
  deleteEndpoint,
  listDeliveries,
  listEndpoints,
  retryDelivery,
  sendTestEvent,
  updateEndpoint,
} from "../services/webhook.service.js";

const url = z.url().max(2048);

const webhooksRouter = new Hono<DashboardEnv>();
webhooksRouter.use("*", dashBoardAuth);

webhooksRouter.get("/", requiredRole("viewer"), async (c) => {
  return c.json({ endpoints: await listEndpoints(c.get("tenantId")) });
});

webhooksRouter.post("/", requiredRole("admin"), async (c) => {
  const input = await parseBody(c, z.object({ url }));
  const { endpoint, secret } = await createEndpoint(c.get("tenantId"), input.url);
  return c.json(
    {
      endpoint,
      secret,
      message: "Store this signing secret securely, it will only be shown once.",
    },
    201,
  );
});

webhooksRouter.get("/deliveries", requiredRole("viewer"), async (c) => {
  return c.json({ deliveries: await listDeliveries(c.get("tenantId")) });
});

webhooksRouter.post("/deliveries/:id/retry", requiredRole("admin"), async (c) => {
  const delivery = await retryDelivery(
    c.get("tenantId"),
    parseId(c.req.param("id"), "Delivery"),
  );
  return c.json({ delivery }, 202);
});

webhooksRouter.patch("/:id", requiredRole("admin"), async (c) => {
  const changes = await parseBody(
    c,
    z.object({ url: url.optional(), enabled: z.boolean().optional() }),
  );
  const endpoint = await updateEndpoint(
    c.get("tenantId"),
    parseId(c.req.param("id"), "Webhook endpoint"),
    changes,
  );
  return c.json({ endpoint });
});

webhooksRouter.delete("/:id", requiredRole("admin"), async (c) => {
  await deleteEndpoint(c.get("tenantId"), parseId(c.req.param("id"), "Webhook endpoint"));
  return c.body(null, 204);
});

webhooksRouter.post("/:id/test", requiredRole("admin"), async (c) => {
  const delivery = await sendTestEvent(
    c.get("tenantId"),
    parseId(c.req.param("id"), "Webhook endpoint"),
  );
  return c.json({ delivery }, 202);
});

export default webhooksRouter;
