import { Hono } from "hono";
import { createTenant } from "../services/tenant.service.js";

const tenantsRouter = new Hono();

tenantsRouter.post("/", async (c) => {
  const body = await c.req.json();
  const tenant = await createTenant(body);
  return c.json(
    {
      success: true,
      message: "Tenant created successfully",
      data: tenant,
    },
    201,
  );
});

export default tenantsRouter;
