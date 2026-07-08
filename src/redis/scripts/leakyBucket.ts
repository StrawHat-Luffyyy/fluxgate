/**
 * Leaky Bucket Rate Limiter
 *
 * ARGV[1] = Bucket Capacity
 * ARGV[2] = Leak Rate (units/sec)
 * ARGV[3] = Current Timestamp (seconds)
 * ARGV[4] = Requested Capacity
 *
 * Returns:
 * {
 *   allowed (1|0),
 *   remainingCapacity,
 *   retryAfterSeconds
 * }
 */

export const leakyBucketLua = `
  local key = KEYS[1]
  local capacity = tonumber(ARGV[1])
  local leak_rate = tonumber(ARGV[2])
  local now = tonumber(ARGV[3])
  local requested = tonumber(ARGV[4])

  -- Load Current Bucket State
  local data = redis.call('HMGET', key, 'water', 'last_updated')
  local water = tonumber(data[1])
  local last_updated = tonumber(data[2])

  -- Initialize Bucket
  if not water then
      water = 0
      last_updated = now
  else
      local elapsed = math.max(0, now - last_updated)
      local leaked = elapsed * leak_rate
      water = math.max(0, water - leaked)
  end

  -- Process Request
  local allowed = 0
  local retryAfter = 0
  if (water + requested) <= capacity then
      water = water + requested
      allowed = 1
  else
      local overflow = (water + requested) - capacity
      retryAfter = math.ceil(overflow / leak_rate)
  end

  -- Persist State
  redis.call('HMSET', key, 'water', water, 'last_updated', now)
  redis.call('EXPIRE', key, 60)

  -- Calculate Remaining Capacity
  local remaining = math.max(
      0,
      math.floor(capacity - water)
  )

  -- Return Standardized Result
  return {
      allowed,
      remaining,
      retryAfter
  }
  `;