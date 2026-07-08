/**
 * Sliding Window Rate Limiter
 *
 * KEYS[1] = Redis Sorted Set key
 *
 * ARGV[1] = Current timestamp (milliseconds)
 * ARGV[2] = Window duration (milliseconds)
 * ARGV[3] = Maximum requests
 * ARGV[4] = Unique request ID
 *
 * Returns:
 * {
 *   allowed (1|0),
 *   remainingRequests,
 *   retryAfterMilliseconds
 * }
 */

export const SLIDING_WINDOW_LUA = `
  local key = KEYS[1]
  local now = tonumber(ARGV[1])
  local window = tonumber(ARGV[2])
  local limit = tonumber(ARGV[3])
  local requestId = ARGV[4]

  -- Remove expired requests
  local clearBefore = now - window
  redis.call(
      'ZREMRANGEBYSCORE',
      key,
      '-inf',
      clearBefore
  )

  -- Count requests in current window
  local currentCount =
      redis.call('ZCARD', key)

  -- Process request
  local allowed = 0
  local remaining = 0
  local retryAfter = 0
  if currentCount < limit then
      local member =
          now .. ":" .. requestId
      redis.call(
          'ZADD',
          key,
          now,
          member
      )
      redis.call(
          'PEXPIRE',
          key,
          window
      )
      allowed = 1
      remaining = limit - currentCount - 1
  else
      -- Find oldest request in active window
      local oldest =
          redis.call(
              'ZRANGE',
              key,
              0,
              0,
              'WITHSCORES'
          )
      if oldest[2] then
          retryAfter =
              math.max(
                  0,
                  window - (now - tonumber(oldest[2]))
              )
      end
  end

  -- Return standardized result
  return {
      allowed,
      remaining,
      retryAfter
  }
  `;
