/**
 * Sliding window log: stores one sorted-set member per accepted request, so there
 * is no boundary burst, at a memory cost of O(limit) per key.
 *
 * KEYS[1] = sorted set key
 * ARGV[1] = window (milliseconds)
 * ARGV[2] = maximum requests per window
 * ARGV[3] = unique request id
 *
 * Returns { allowed (1|0), remaining requests, retry-after milliseconds }.
 */
export const slidingWindowLua = `
  local key = KEYS[1]
  local window = tonumber(ARGV[1])
  local limit = tonumber(ARGV[2])
  local request_id = ARGV[3]

  local time = redis.call('TIME')
  local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)

  redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
  local count = redis.call('ZCARD', key)

  if count < limit then
    redis.call('ZADD', key, now, request_id)
    redis.call('PEXPIRE', key, window)
    return { 1, limit - count - 1, 0 }
  end

  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retry_after = 0
  if oldest[2] then
    retry_after = math.max(0, window - (now - tonumber(oldest[2])))
  end
  return { 0, 0, retry_after }
`;
