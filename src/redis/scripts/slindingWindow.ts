/**
 * KEYS[1]: Redis Sorted Set key (e.g., "ratelimit:tenant_abc")
 * ARGV[1]: Current timestamp (ms)
 * ARGV[2]: Window duration (ms)
 * ARGV[3]: Max allowed requests per window
 * ARGV[4]: Unique Request Salt (prevents collision overwrites)
 */

export const SLIDING_WINDOW_LUA = `
  local key = KEYS[1]
  local now = tonumber(ARGV[1])
  local window = tonumber(ARGV[2])
  local limit = tonumber(ARGV[3])
  local reqId = ARGV[4]

  local clearBefore = now - window

  -- 1. O(log(N)+M) - Drop all records older than the sliding window
  redis.call('ZREMRANGEBYSCORE', key, '-inf', clearBefore)
  -- 2. O(1) - Count current requests inside active window
  local currentCount = redis.call('ZCARD', key)

  if currentCount < limit then
    -- 3a. ALLOWED: Log this request and refresh key expiration
    local member = now .. ":" .. reqId
    redis.call('ZADD', key, now, member)
    redis.call('PEXPIRE', key, window)

    return { 1, limit - currentCount - 1 }
  else
    -- 3b. BLOCKED: Do not record the request
    return { 0, 0 }
  end
`;
