import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../lib/AppError.js";
import { parseBody, parseId } from "../lib/validate.js";
import { dashBoardAuth, type DashboardEnv } from "../middleware/dashBoardAuth.js";
import { requiredRole } from "../middleware/rbac.js";
import { listAnomalies, updateAnomalyStatus } from "../services/anomaly.service.js";

const status = z.enum(["open", "acknowledged", "resolved"]);

const listQuery = z.object({
  status: status.optional(),
  cursor: z.string().max(128).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const encodeCursor = (row: { detectedAt: Date; id: string }) =>
  `${row.detectedAt.toISOString()}_${row.id}`;

const decodeCursor = (raw: string) => {
  const [detectedAt, id] = raw.split("_");
  const parsed = new Date(detectedAt);
  if (Number.isNaN(parsed.getTime()) || !z.uuid().safeParse(id).success) {
    throw AppError.badRequest("Invalid cursor", "VALIDATION_ERROR");
  }
  return { detectedAt: parsed, id };
};

const anomaliesRouter = new Hono<DashboardEnv>();
anomaliesRouter.use("*", dashBoardAuth);

anomaliesRouter.get("/", requiredRole("viewer"), async (c) => {
  const query = listQuery.safeParse(c.req.query());
  if (!query.success) throw AppError.badRequest("Invalid query parameters", "VALIDATION_ERROR");
  const { cursor, ...rest } = query.data;
  const anomalies = await listAnomalies(c.get("tenantId"), {
    ...rest,
    cursor: cursor ? decodeCursor(cursor) : undefined,
  });
  const last = anomalies.at(-1);
  return c.json({
    anomalies,
    nextCursor: last && anomalies.length === rest.limit ? encodeCursor(last) : null,
  });
});

anomaliesRouter.patch("/:id", requiredRole("admin"), async (c) => {
  const input = await parseBody(c, z.object({ status }));
  const anomaly = await updateAnomalyStatus(
    c.get("tenantId"),
    parseId(c.req.param("id"), "Anomaly"),
    input.status,
  );
  return c.json({ anomaly });
});

export default anomaliesRouter;
