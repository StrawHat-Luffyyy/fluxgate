import { describe, it, expect, beforeEach, vi } from "vitest";
import { tokenBucketLua } from "../../src/redis/scripts/tokenBucket.js";
import { leakyBucketLua } from "../../src/redis/scripts/leakyBucket.js";
import { SLIDING_WINDOW_LUA } from "../../src/redis/scripts/slindingWindow.js";
import { mockRedisClient, redisState } from "./redis-mock.js";

vi.mock("../../src/redis/client.js", () => ({
  redis: mockRedisClient,
}));

import { redis } from "../../src/redis/client.js";

describe("Rate Limiting Algorithms Boundary Unit Tests", () => {
  beforeEach(() => {
    redisState.clear();
  });

  describe("Token Bucket Algorithm", () => {
    it("should allow requests up to capacity, reject 1 over limit, and refill after time passes", async () => {
      const key = "test:ratelimit:tb:tenant-1";
      const capacity = 5;
      const refillRate = 1; // 1 token per sec
      let now = 1000;

      // 1. Consume 5 tokens (up to capacity)
      for (let i = 0; i < capacity; i++) {
        const [allowed, remaining] = (await redis.eval(
          tokenBucketLua,
          1,
          key,
          capacity.toString(),
          refillRate.toString(),
          now.toString(),
          "1",
        )) as [number, number, number];

        expect(allowed).toBe(1);
        expect(remaining).toBe(capacity - 1 - i);
      }

      // 2. Request 1 over limit -> Rejected
      const [allowedOver, remainingOver, retryAfter] = (await redis.eval(
        tokenBucketLua,
        1,
        key,
        capacity.toString(),
        refillRate.toString(),
        now.toString(),
        "1",
      )) as [number, number, number];

      expect(allowedOver).toBe(0);
      expect(remainingOver).toBe(0);
      expect(retryAfter).toBeGreaterThan(0);

      // 3. Advance time by 2 seconds -> Should refill 2 tokens
      now += 2;
      const [allowedRefill, remainingRefill] = (await redis.eval(
        tokenBucketLua,
        1,
        key,
        capacity.toString(),
        refillRate.toString(),
        now.toString(),
        "1",
      )) as [number, number, number];

      expect(allowedRefill).toBe(1);
      expect(remainingRefill).toBe(1); // 2 refilled - 1 consumed = 1
    });
  });

  describe("Leaky Bucket Algorithm", () => {
    it("should process requests up to bucket capacity and leak over time", async () => {
      const key = "test:ratelimit:lb:tenant-1";
      const capacity = 4;
      const leakRate = 1; // 1 unit per sec
      let now = 2000;

      // 1. Fill bucket to capacity
      for (let i = 0; i < capacity; i++) {
        const [allowed, remaining] = (await redis.eval(
          leakyBucketLua,
          1,
          key,
          capacity.toString(),
          leakRate.toString(),
          now.toString(),
          "1",
        )) as [number, number, number];

        expect(allowed).toBe(1);
        expect(remaining).toBe(capacity - 1 - i);
      }

      // 2. Request when bucket is full -> Rejected
      const [allowedOver, remainingOver, retryAfter] = (await redis.eval(
        leakyBucketLua,
        1,
        key,
        capacity.toString(),
        leakRate.toString(),
        now.toString(),
        "1",
      )) as [number, number, number];

      expect(allowedOver).toBe(0);
      expect(remainingOver).toBe(0);
      expect(retryAfter).toBeGreaterThan(0);

      // 3. Advance time by 3 seconds -> Leaks 3 units
      now += 3;
      const [allowedPostLeak, remainingPostLeak] = (await redis.eval(
        leakyBucketLua,
        1,
        key,
        capacity.toString(),
        leakRate.toString(),
        now.toString(),
        "1",
      )) as [number, number, number];

      expect(allowedPostLeak).toBe(1);
      expect(remainingPostLeak).toBe(2);
    });
  });

  describe("Sliding Window Algorithm", () => {
    it("should accurately maintain request log across window boundaries", async () => {
      const key = "test:ratelimit:sw:tenant-1";
      const limit = 3;
      const windowMs = 1000; // 1 second window
      let now = 10000;

      // 1. Send 3 requests (exact limit)
      for (let i = 0; i < limit; i++) {
        const [allowed, remaining] = (await redis.eval(
          SLIDING_WINDOW_LUA,
          1,
          key,
          now.toString(),
          windowMs.toString(),
          limit.toString(),
          `req-${i}`,
        )) as [number, number, number];

        expect(allowed).toBe(1);
        expect(remaining).toBe(limit - 1 - i);
      }

      // 2. 4th request within window -> Rejected
      const [allowedOver, _, retryAfter] = (await redis.eval(
        SLIDING_WINDOW_LUA,
        1,
        key,
        now.toString(),
        windowMs.toString(),
        limit.toString(),
        "req-overflow",
      )) as [number, number, number];

      expect(allowedOver).toBe(0);
      expect(retryAfter).toBeGreaterThan(0);

      // 3. Advance time past window -> Window resets, requests allowed again
      now += windowMs + 10;
      const [allowedReset, remainingReset] = (await redis.eval(
        SLIDING_WINDOW_LUA,
        1,
        key,
        now.toString(),
        windowMs.toString(),
        limit.toString(),
        "req-new-window",
      )) as [number, number, number];

      expect(allowedReset).toBe(1);
      expect(remainingReset).toBe(limit - 1);
    });
  });
});
