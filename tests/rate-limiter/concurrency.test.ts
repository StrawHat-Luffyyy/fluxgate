import { describe, it, expect, beforeEach, vi } from "vitest";
import { tokenBucketLua } from "../../src/redis/scripts/tokenBucket.js";
import { leakyBucketLua } from "../../src/redis/scripts/leakyBucket.js";
import { SLIDING_WINDOW_LUA } from "../../src/redis/scripts/slindingWindow.js";
import { mockRedisClient, redisState } from "./redis-mock.js";

vi.mock("../../src/redis/client.js", () => ({
  redis: mockRedisClient,
}));

import { redis } from "../../src/redis/client.js";

describe("Lua Script Atomicity under Concurrent Requests", () => {
  beforeEach(() => {
    redisState.clear();
  });

  it("Token Bucket: 100 concurrent requests against capacity 10 -> exactly 10 pass and 90 fail", async () => {
    const key = "test:concurrent:tb:tenant-1";
    const capacity = 10;
    const refillRate = 0; // Disable refill during concurrent burst
    const now = 1000;
    const concurrentRequests = 100;

    const promises = Array.from({ length: concurrentRequests }, () =>
      redis.eval(
        tokenBucketLua,
        1,
        key,
        capacity.toString(),
        refillRate.toString(),
        now.toString(),
        "1",
      ),
    );

    const results = (await Promise.all(promises)) as Array<[number, number, number]>;

    const passedCount = results.filter(([allowed]) => allowed === 1).length;
    const failedCount = results.filter(([allowed]) => allowed === 0).length;

    expect(passedCount).toBe(10);
    expect(failedCount).toBe(90);
  });

  it("Sliding Window: 100 concurrent requests against limit 15 -> exactly 15 pass and 85 fail", async () => {
    const key = "test:concurrent:sw:tenant-1";
    const limit = 15;
    const windowMs = 60000;
    const now = Date.now();
    const concurrentRequests = 100;

    const promises = Array.from({ length: concurrentRequests }, (_, i) =>
      redis.eval(
        SLIDING_WINDOW_LUA,
        1,
        key,
        now.toString(),
        windowMs.toString(),
        limit.toString(),
        `req-${i}-${crypto.randomUUID()}`,
      ),
    );

    const results = (await Promise.all(promises)) as Array<[number, number, number]>;

    const passedCount = results.filter(([allowed]) => allowed === 1).length;
    const failedCount = results.filter(([allowed]) => allowed === 0).length;

    expect(passedCount).toBe(15);
    expect(failedCount).toBe(85);
  });
});
