// In-memory Redis state mock for offline unit testing
export const redisState = new Map<string, any>();

export const mockRedisClient = {
  keys: async (pattern: string) => {
    const keys = Array.from(redisState.keys());
    return keys.filter((k) => k.startsWith(pattern.replace("*", "")));
  },
  del: async (...keys: string[]) => {
    keys.forEach((k) => redisState.delete(k));
    return keys.length;
  },
  eval: async (script: string, numkeys: number, key: string, ...args: string[]) => {
    // 1. Token Bucket
    if (script.includes("HMGET") && script.includes("tokens")) {
      const capacity = parseFloat(args[0]);
      const refillRate = parseFloat(args[1]);
      const now = parseFloat(args[2]);
      const requested = parseFloat(args[3]);

      let data = redisState.get(key) || {};
      let tokens = data.tokens !== undefined ? data.tokens : capacity;
      let lastUpdated = data.last_updated !== undefined ? data.last_updated : now;

      const elapsed = Math.max(0, now - lastUpdated);
      tokens = Math.min(capacity, tokens + elapsed * refillRate);

      let allowed = 0;
      let retryAfter = 0;

      if (tokens >= requested) {
        tokens -= requested;
        allowed = 1;
      } else {
        const deficit = requested - tokens;
        retryAfter = Math.ceil(deficit / refillRate);
      }

      redisState.set(key, { tokens, last_updated: now });
      return [allowed, Math.floor(tokens), retryAfter];
    }

    // 2. Leaky Bucket
    if (script.includes("HMGET") && script.includes("water")) {
      const capacity = parseFloat(args[0]);
      const leakRate = parseFloat(args[1]);
      const now = parseFloat(args[2]);
      const requested = parseFloat(args[3]);

      let data = redisState.get(key) || {};
      let water = data.water !== undefined ? data.water : 0;
      let lastUpdated = data.last_updated !== undefined ? data.last_updated : now;

      const elapsed = Math.max(0, now - lastUpdated);
      const leaked = elapsed * leakRate;
      water = Math.max(0, water - leaked);

      let allowed = 0;
      let retryAfter = 0;

      if (water + requested <= capacity) {
        water += requested;
        allowed = 1;
      } else {
        const overflow = water + requested - capacity;
        retryAfter = Math.ceil(overflow / leakRate);
      }

      redisState.set(key, { water, last_updated: now });
      const remaining = Math.max(0, Math.floor(capacity - water));
      return [allowed, remaining, retryAfter];
    }

    // 3. Sliding Window
    if (script.includes("ZREMRANGEBYSCORE")) {
      const now = parseFloat(args[0]);
      const window = parseFloat(args[1]);
      const limit = parseFloat(args[2]);
      const requestId = args[3];

      let set: Array<{ score: number; member: string }> = redisState.get(key) || [];
      const clearBefore = now - window;
      set = set.filter((item) => item.score > clearBefore);

      const currentCount = set.length;
      let allowed = 0;
      let remaining = 0;
      let retryAfter = 0;

      if (currentCount < limit) {
        const member = `${now}:${requestId}`;
        set.push({ score: now, member });
        allowed = 1;
        remaining = limit - currentCount - 1;
      } else {
        const oldest = set[0];
        if (oldest) {
          retryAfter = Math.max(0, window - (now - oldest.score));
        }
      }

      redisState.set(key, set);
      return [allowed, remaining, retryAfter];
    }

    return [1, 10, 0];
  },
};
