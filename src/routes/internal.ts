import { Hono } from "hono";
import { webhookQueue } from "../queue/webhookQueue.js";

const internalRouter = new Hono();

internalRouter.post("/alerts", async (c) => {
  const body = await c.req.json();
  if (!body.tenantId || !body.alertType) {
    return c.json({ error: "Invalid payload" }, 400);
  }
  // Enqueue the job instead of sending it immediately
  const job = await webhookQueue.add("send-webhook", body);
  return c.json({ success: true, jobId: job.id }, 202);
});

export default internalRouter;
