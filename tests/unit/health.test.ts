import { describe, it, expect } from "vitest";
import app from "../../src/app.js";

describe("Health Route", () => {
  it("should return 200 OK and system uptime", async () => {
    const res = await app.request("/health");

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("status", "ok");
    expect(body).toHaveProperty("timestamp");
    expect(body).toHaveProperty("uptime");
  });
  it("should return 404 for unknown routes", async () => {
    const res = await app.request("/does-not-exist");

    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe("NOT_FOUND");
    expect(body.message).toBe("Route not found");
    expect(body.path).toBe("/does-not-exist");
  });
});
