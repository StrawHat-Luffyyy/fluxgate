import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { authMiddleware } from "../../src/middleware/auth.js";
const mockDrizzleQuery = {
  select: () => mockDrizzleQuery,
  from: () => mockDrizzleQuery,
  where: () => mockDrizzleQuery,
  limit: () => mockDrizzleQuery,
  // This turns the mock into a "thenable" that awaits perfectly into an array
  then: (onFulfilled: (value: any[]) => any) =>
    onFulfilled([
      {
        tenantId: "fake-tenant-123",
        expiresAt: null,
      },
    ]),
};

vi.mock("../../src/db/index.js", () => ({
  db: mockDrizzleQuery,
}));

describe("Auth Middleware", () => {
  const testApp = new Hono();
  testApp.get("/protected", authMiddleware, (c) => {
    return c.json({ tenantId: c.get("tenantId") });
  });
  it("should reject request without an Authorization header", async () => {
    const res = await testApp.request("/protected");
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.message).toBe("Missing or invalid Authorization header");
  });
  it("should allow request with a valid API Key inject tenant context", async () => {
    const req = new Request("http://localhost/protected", {
      headers: {
        Authorization: "Bearer fg_live_fakekey123",
      },
    });
    const res = await testApp.request(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tenantId).toBe("fake-tenant-123");
  });
});
