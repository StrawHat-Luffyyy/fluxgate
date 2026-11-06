import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { redis } from "../../src/redis/client.js";
import { waitForRedis } from "./helpers.js";

// These run the real Lua scripts inside a real Redis. There is no mock here.

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const sum = (results: number[][]) => results.reduce((total, [allowed]) => total + allowed, 0);

describe("rate limit scripts against real Redis", () => {
  beforeAll(waitForRedis);
  beforeEach(async () => {
    await redis.flushdb();
  });

  describe("token bucket", () => {
    const take = (key: string, capacity: number, rate: number) =>
      redis.rlTokenBucket(key, capacity.toString(), rate.toString(), "1");

    it("allows up to capacity, then rejects with retry-after", async () => {
      for (let i = 0; i < 5; i++) {
        const [allowed, remaining] = await take("tb", 5, 1);
        expect(allowed).toBe(1);
        expect(remaining).toBe(4 - i);
      }
      const [allowed, remaining, retryAfter] = await take("tb", 5, 1);
      expect(allowed).toBe(0);
      expect(remaining).toBe(0);
      expect(retryAfter).toBeGreaterThanOrEqual(1);
    });

    it("refills over real time", async () => {
      for (let i = 0; i < 2; i++) await take("tb", 2, 20);
      expect((await take("tb", 2, 20))[0]).toBe(0);
      await sleep(120);
      expect((await take("tb", 2, 20))[0]).toBe(1);
    });

    it("never refills above capacity", async () => {
      await take("tb", 3, 1000);
      await sleep(50);
      const [, remaining] = await take("tb", 3, 1000);
      expect(remaining).toBe(2);
    });

    it("sets its TTL from the refill time, so slow buckets do not reset early", async () => {
      await take("tb", 600, 1); // Ten minutes to refill.
      const ttl = await redis.ttl("tb");
      expect(ttl).toBeGreaterThan(590);
    });

    it("admits exactly capacity under 500 concurrent requests", async () => {
      const results = await Promise.all(
        Array.from({ length: 500 }, () => take("tb", 100, 0.001)),
      );
      expect(sum(results)).toBe(100);
    });
  });

  describe("leaky bucket", () => {
    const pour = (key: string, capacity: number, rate: number) =>
      redis.rlLeakyBucket(key, capacity.toString(), rate.toString(), "1");

    it("accepts up to capacity, then rejects", async () => {
      for (let i = 0; i < 3; i++) {
        const [allowed, remaining] = await pour("lb", 3, 0.5);
        expect(allowed).toBe(1);
        expect(remaining).toBe(2 - i);
      }
      const [allowed, , retryAfter] = await pour("lb", 3, 0.5);
      expect(allowed).toBe(0);
      expect(retryAfter).toBeGreaterThanOrEqual(1);
    });

    it("drains over real time", async () => {
      for (let i = 0; i < 2; i++) await pour("lb", 2, 20);
      expect((await pour("lb", 2, 20))[0]).toBe(0);
      await sleep(120);
      expect((await pour("lb", 2, 20))[0]).toBe(1);
    });

    it("sets its TTL from the drain time", async () => {
      await pour("lb", 600, 1);
      expect(await redis.ttl("lb")).toBeGreaterThan(590);
    });

    it("admits exactly capacity under 500 concurrent requests", async () => {
      const results = await Promise.all(
        Array.from({ length: 500 }, () => pour("lb", 100, 0.001)),
      );
      expect(sum(results)).toBe(100);
    });
  });

  describe("sliding window", () => {
    const hit = (key: string, windowMs: number, limit: number) =>
      redis.rlSlidingWindow(key, windowMs.toString(), limit.toString(), crypto.randomUUID());

    it("allows up to the limit, then rejects with retry-after in milliseconds", async () => {
      for (let i = 0; i < 3; i++) {
        const [allowed, remaining] = await hit("sw", 60_000, 3);
        expect(allowed).toBe(1);
        expect(remaining).toBe(2 - i);
      }
      const [allowed, remaining, retryAfter] = await hit("sw", 60_000, 3);
      expect(allowed).toBe(0);
      expect(remaining).toBe(0);
      expect(retryAfter).toBeGreaterThan(50_000);
      expect(retryAfter).toBeLessThanOrEqual(60_000);
    });

    it("frees capacity as requests age out of the window", async () => {
      await hit("sw", 150, 1);
      expect((await hit("sw", 150, 1))[0]).toBe(0);
      await sleep(200);
      expect((await hit("sw", 150, 1))[0]).toBe(1);
    });

    it("has no boundary burst: a request stays counted for the full window", async () => {
      await hit("sw", 300, 2);
      await sleep(200);
      await hit("sw", 300, 2);
      await sleep(150); // First aged out, second still inside.
      expect((await hit("sw", 300, 2))[0]).toBe(1);
      expect((await hit("sw", 300, 2))[0]).toBe(0);
    });

    it("does not count rejected requests", async () => {
      await hit("sw", 60_000, 1);
      await hit("sw", 60_000, 1);
      await hit("sw", 60_000, 1);
      expect(await redis.zcard("sw")).toBe(1);
    });

    it("expires the key after the window", async () => {
      await hit("sw", 5_000, 1);
      const ttl = await redis.pttl("sw");
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(5_000);
    });

    it("admits exactly the limit under 500 concurrent requests", async () => {
      const results = await Promise.all(
        Array.from({ length: 500 }, () => hit("sw", 60_000, 100)),
      );
      expect(sum(results)).toBe(100);
    });
  });

  it("keeps separate keys independent", async () => {
    await redis.rlTokenBucket("a", "1", "0.001", "1");
    expect((await redis.rlTokenBucket("a", "1", "0.001", "1"))[0]).toBe(0);
    expect((await redis.rlTokenBucket("b", "1", "0.001", "1"))[0]).toBe(1);
  });
});
