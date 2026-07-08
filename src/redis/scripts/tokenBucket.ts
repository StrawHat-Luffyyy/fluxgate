/**
 * Token Bucket Rate Limiter
 *
 * ARGV[1] = Capacity
 * ARGV[2] = Refill Rate (tokens/sec)
 * ARGV[3] = Current Timestamp (seconds)
 * ARGV[4] = Requested Tokens
 *
 * Returns:
 * {
 *   allowed (1|0),
 *   remainingTokens,
 *   retryAfterSeconds
 * }
 */

export const tokenBucketLua = `
  local key = KEYS[1]
  local capacity = tonumber(ARGV[1])
  local refill_rate = tonumber(ARGV[2])
  local now = tonumber(ARGV[3])
  local requested = tonumber(ARGV[4])

  -- Load current bucket
  local data = redis.call('HMGET', key, 'tokens', 'last_updated')
  local tokens = tonumber(data[1])
  local last_updated = tonumber(data[2])

  -- Initialize bucket
  if not tokens then
      tokens = capacity
      last_updated = now
  else
      local elapsed = math.max(0, now - last_updated)
      tokens = math.min(
          capacity,
          tokens + (elapsed * refill_rate)
      )
  end

  -- Consume Tokens
  local allowed = 0
  local retryAfter = 0

  if tokens >= requested then
      tokens = tokens - requested
      allowed = 1
  else
      local deficit = requested - tokens
      retryAfter = math.ceil(deficit / refill_rate)
  end

  -- Persist state
  redis.call('HMSET', key, 'tokens', tokens, 'last_updated', now)
  redis.call('EXPIRE', key, 60)

  -- Return Result
  return {
      allowed,
      math.floor(tokens),
      retryAfter
  }
  `;
