/**
 * Leaky bucket (as a meter): requests add water, which drains at a fixed rate.
 * Sustained throughput is bounded by the leak rate, bursts by the capacity.
 *
 * KEYS[1] = bucket key
 * ARGV[1] = capacity
 * ARGV[2] = leak rate (units/sec, must be > 0)
 * ARGV[3] = units requested
 *
 * Returns { allowed (1|0), remaining capacity, retry-after seconds }.
 * The TTL is the time to drain completely, when a missing key means the same thing.
 */
export const leakyBucketLua = `
  local key = KEYS[1]
  local capacity = tonumber(ARGV[1])
  local leak_rate = tonumber(ARGV[2])
  local requested = tonumber(ARGV[3])

  local time = redis.call('TIME')
  local now = tonumber(time[1]) + (tonumber(time[2]) / 1000000)

  local data = redis.call('HMGET', key, 'water', 'last_updated')
  local water = tonumber(data[1])
  local last_updated = tonumber(data[2])

  if not water then
    water = 0
  else
    local elapsed = math.max(0, now - last_updated)
    water = math.max(0, water - (elapsed * leak_rate))
  end

  local allowed = 0
  local retry_after = 0
  if (water + requested) <= capacity then
    water = water + requested
    allowed = 1
  else
    retry_after = math.ceil(((water + requested) - capacity) / leak_rate)
  end

  redis.call('HSET', key, 'water', water, 'last_updated', now)
  redis.call('EXPIRE', key, math.ceil(capacity / leak_rate) + 1)

  return { allowed, math.max(0, math.floor(capacity - water)), retry_after }
`;
