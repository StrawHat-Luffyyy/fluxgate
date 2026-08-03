import "dotenv/config";
import { describe, it, expect, vi, beforeEach } from "vitest";
import app from "../../src/app.js";
import { sign } from "hono/jwt";

let mockDbResultQueue: any[][] = [];

vi.mock("../../src/db/index.js", () => {
  const mockDrizzleQuery: any = {
    select: () => mockDrizzleQuery,
    insert: () => mockDrizzleQuery,
    values: () => mockDrizzleQuery,
    from: () => mockDrizzleQuery,
    where: () => mockDrizzleQuery,
    limit: () => mockDrizzleQuery,
    returning: () => mockDrizzleQuery,
    then: (onFulfilled: (value: any[]) => any) => {
      const res = mockDbResultQueue.shift() || [];
      return onFulfilled(res);
    },
  };
  return {
    db: mockDrizzleQuery,
  };
});

vi.mock("../../src/redis/client.js", () => {
  return {
    redis: {
      del: vi.fn().mockResolvedValue(1),
      get: vi.fn(),
      set: vi.fn(),
    },
  };
});

describe("Authentication & Admin Routes", () => {
  beforeEach(() => {
    mockDbResultQueue = [];
  });

  describe("POST /auth/register", () => {
    it("should successfully register a new user", async () => {
      // 1. Tenant exists check returns tenant
      // 2. User exists check returns empty (user doesn't exist)
      // 3. User insert returns newUser details
      mockDbResultQueue.push(
        [{ id: "tenant-123", name: "Test Tenant" }],
        [],
        [{ id: "user-123", email: "admin@test.com", tenantId: "tenant-123", role: "admin" }]
      );

      const req = new Request("http://localhost/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "admin@test.com",
          password: "password123",
          tenantId: "tenant-123",
          role: "admin",
        }),
      });

      const res = await app.request(req);
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.user.email).toBe("admin@test.com");
      expect(body.user.role).toBe("admin");
    });

    it("should fail when missing required fields", async () => {
      const req = new Request("http://localhost/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "admin@test.com",
        }),
      });

      const res = await app.request(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("MISSING_FIELDS");
      expect(body.message).toBe("Email, password and tenantId required");
    });
  });

  describe("Admin Router Protection & Operations", () => {
    it("should reject admin request when no session exists", async () => {
      const res = await app.request("/admin/routes");
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Unauthorized");
    });

    it("should reject non-admin users for post routes", async () => {
      // Create a cookie token
      const token = await sign(
        { userId: "user-123", tenantId: "tenant-123", exp: Math.floor(Date.now() / 1000) + 3600 },
        "default-jwt-secret-key"
      );

      // dashBoardAuth select user role -> viewer
      mockDbResultQueue.push([{ role: "viewer" }]);

      const req = new Request("http://localhost/admin/routes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": `Fluxgate_session=${token}`,
        },
        body: JSON.stringify({
          pathPrefix: "/posts",
          targetUrl: "https://jsonplaceholder.typicode.com/posts",
        }),
      });

      const res = await app.request(req);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("Forbidden");
    });

    it("should allow admin to register a new gateway route", async () => {
      const token = await sign(
        { userId: "user-123", tenantId: "tenant-123", exp: Math.floor(Date.now() / 1000) + 3600 },
        "default-jwt-secret-key"
      );

      // 1. dashBoardAuth select user role -> admin
      // 2. adminRouter insert route -> returns new route
      mockDbResultQueue.push(
        [{ role: "admin" }],
        [{ id: "route-1", tenantId: "tenant-123", pathPrefix: "/posts", targetUrl: "https://jsonplaceholder.typicode.com/posts" }]
      );

      const req = new Request("http://localhost/admin/routes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": `Fluxgate_session=${token}`,
        },
        body: JSON.stringify({
          pathPrefix: "/posts",
          targetUrl: "https://jsonplaceholder.typicode.com/posts",
        }),
      });

      const res = await app.request(req);
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.route.pathPrefix).toBe("/posts");
    });

    it("should allow viewer role to list gateway routes", async () => {
      const token = await sign(
        { userId: "user-123", tenantId: "tenant-123", exp: Math.floor(Date.now() / 1000) + 3600 },
        "default-jwt-secret-key"
      );

      // 1. dashBoardAuth select user role -> viewer
      // 2. adminRouter select routes -> list of routes
      mockDbResultQueue.push(
        [{ role: "viewer" }],
        [{ id: "route-1", tenantId: "tenant-123", pathPrefix: "/posts", targetUrl: "https://jsonplaceholder.typicode.com/posts" }]
      );

      const req = new Request("http://localhost/admin/routes", {
        method: "GET",
        headers: {
          "Cookie": `Fluxgate_session=${token}`,
        },
      });

      const res = await app.request(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.routes.length).toBe(1);
    });
  });
});
