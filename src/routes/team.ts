import { Hono } from "hono";
import { z } from "zod";
import { parseBody, parseId } from "../lib/validate.js";
import { dashBoardAuth, type DashboardEnv } from "../middleware/dashBoardAuth.js";
import { requiredRole } from "../middleware/rbac.js";
import {
  createMember,
  listMembers,
  removeMember,
  updateMemberRole,
} from "../services/team.service.js";
import { emailSchema, newPassword } from "./auth.js";

const role = z.enum(["admin", "viewer"]);

const teamRouter = new Hono<DashboardEnv>();
teamRouter.use("*", dashBoardAuth);

teamRouter.get("/", requiredRole("viewer"), async (c) => {
  return c.json({ members: await listMembers(c.get("tenantId")) });
});

teamRouter.post("/", requiredRole("admin"), async (c) => {
  const input = await parseBody(
    c,
    z.object({ email: emailSchema, password: newPassword, role }),
  );
  return c.json({ member: await createMember(c.get("tenantId"), input) }, 201);
});

teamRouter.patch("/:id", requiredRole("admin"), async (c) => {
  const input = await parseBody(c, z.object({ role }));
  const member = await updateMemberRole(
    c.get("tenantId"),
    parseId(c.req.param("id"), "Team member"),
    input.role,
  );
  return c.json({ member });
});

teamRouter.delete("/:id", requiredRole("admin"), async (c) => {
  await removeMember(c.get("tenantId"), parseId(c.req.param("id"), "Team member"));
  return c.body(null, 204);
});

export default teamRouter;
