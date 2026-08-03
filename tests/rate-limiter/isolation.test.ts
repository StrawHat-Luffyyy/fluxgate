import { describe, it, expect, beforeEach, vi } from "vitest";
import { tokenBucketLua } from "../../src/redis/scripts/tokenBucket.js";
import { mockRedisClient, redisState } from "./redis-mock.js";

vi.mock("../../src/redis/client.js", () => ({
  redis: mockRedisClient,
}));

import { redis } from "../../src/redis/client.js";

describe("Tenant Isolation Integration Tests", () => {
  beforeEach(() => {
    redisState.clear();
  });

  it("Tenant A exhausting rate limit should NOT affect Tenant B rate limit state", async () => {
    const keyTenantA = "test:isolation:ratelimit:tenant-A";
    const keyTenantB = "test:isolation:ratelimit:tenant-B";
    const capacity = 3;
    const refillRate = 0;
    const now = 1000;

    // 1. Exhaust Tenant A completely
    for (let i = 0; i < capacity; i++) {
      const [allowed] = (await redis.eval(
        tokenBucketLua,
        1,
        keyTenantA,
        capacity.toString(),
        refillRate.toString(),
        now.toString(),
        "1",
      )) as [number, number, number];
      expect(allowed).toBe(1);
    }

    // Tenant A next request should fail
    const [allowedA] = (await redis.eval(
      tokenBucketLua,
      1,
      keyTenantA,
      capacity.toString(),
      refillRate.toString(),
      now.toString(),
      "1",
    )) as [number, number, number];
    expect(allowedA).toBe(0);

    // 2. Tenant B requests should succeed with full initial capacity (completely isolated)
    for (let i = 0; i < capacity; i++) {
      const [allowedB, remainingB] = (await redis.eval(
        tokenBucketLua,
        1,
        keyTenantB,
        capacity.toString(),
        refillRate.toString(),
        now.toString(),
        "1",
      )) as [number, number, number];

      expect(allowedB).toBe(1);
      expect(remainingB).toBe(capacity - 1 - i);
    }
  });
});
