/**
 * Token bucket: permits bursts up to capacity, refilled at a steady rate.
 *
 * KEYS[1] = bucket key
 * ARGV[1] = capacity
 * ARGV[2] = refill rate (tokens/sec, must be > 0)
 * ARGV[3] = tokens requested
 *
 * Returns { allowed (1|0), remaining tokens, retry-after seconds }.
 *
 * Time comes from Redis, not the caller, so clock skew between gateway nodes
 * cannot grant or lose tokens. The TTL is the time to refill completely: after
 * that the bucket is full, which is exactly what a missing key means.
 */
export const tokenBucketLua = `
  local key = KEYS[1]
  local capacity = tonumber(ARGV[1])
  local refill_rate = tonumber(ARGV[2])
  local requested = tonumber(ARGV[3])

  local time = redis.call('TIME')
  local now = tonumber(time[1]) + (tonumber(time[2]) / 1000000)

  local data = redis.call('HMGET', key, 'tokens', 'last_updated')
  local tokens = tonumber(data[1])
  local last_updated = tonumber(data[2])

  if not tokens then
    tokens = capacity
  else
    local elapsed = math.max(0, now - last_updated)
    tokens = math.min(capacity, tokens + (elapsed * refill_rate))
  end

  local allowed = 0
  local retry_after = 0
  if tokens >= requested then
    tokens = tokens - requested
    allowed = 1
  else
    retry_after = math.ceil((requested - tokens) / refill_rate)
  end

  redis.call('HSET', key, 'tokens', tokens, 'last_updated', now)
  redis.call('EXPIRE', key, math.ceil(capacity / refill_rate) + 1)

  return { allowed, math.floor(tokens), retry_after }
`;
