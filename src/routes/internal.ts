import { Hono } from "hono";
import { z } from "zod";
import { env } from "../config/env.js";
import { currentRequestContext, runWithRequestContext } from "../lib/requestContext.js";
import { verifySignature } from "../lib/signature.js";
import { recordAnomaly } from "../services/anomaly.service.js";

const alertSchema = z.object({
  tenantId: z.uuid(),
  alertType: z.string().min(1).max(64),
  requestId: z.string().min(1).max(128),
  detector: z.enum(["forest", "range_guard"]),
  score: z.number(),
  modelVersion: z.string().min(1).max(128),
  topFeature: z.string().min(1).max(64),
  topFeatureValue: z.number(),
  attribution: z.record(z.string(), z.number()),
  features: z.record(z.string(), z.number()),
  message: z.string().max(1024),
  detectedAt: z.iso.datetime({ offset: true }),
});

const internalRouter = new Hono();

/**
 * Called only by ai-service. Authenticated with an HMAC over the raw body instead
 * of a static bearer token, so that a captured request cannot be altered, and can
 * only be replayed within the signature's five-minute window.
 */
internalRouter.post("/alerts", async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header("x-fluxgate-signature");
  if (!verifySignature(signature, env.INTERNAL_ALERT_SECRET, rawBody)) {
    return c.json({ error: "Unauthorized", message: "Invalid signature" }, 401);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "Bad Request", message: "Body must be JSON" }, 400);
  }
  const result = alertSchema.safeParse(parsed);
  if (!result.success) {
    return c.json({ error: "Bad Request", message: "Invalid alert payload" }, 400);
  }

  // Log and queue under the id of the request that caused the alert, not this call,
  // so one id follows it from the gateway through the consumer to the webhook.
  const context = currentRequestContext();
  const outcome = context
    ? await runWithRequestContext({ ...context, requestId: result.data.requestId }, () =>
        recordAnomaly(result.data),
      )
    : await recordAnomaly(result.data);
  return c.json({ success: true, ...outcome }, 202);
});

export default internalRouter;
