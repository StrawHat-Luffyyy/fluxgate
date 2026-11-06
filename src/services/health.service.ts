import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { getKafkaHealth } from "../kafka/producer.js";
import { redis } from "../redis/client.js";

const CHECK_TIMEOUT_MS = 1_000;

type CheckStatus = "up" | "down";

const check = async (probe: () => Promise<unknown>): Promise<CheckStatus> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      probe(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Timed out")), CHECK_TIMEOUT_MS);
      }),
    ]);
    return "up";
  } catch {
    return "down";
  } finally {
    clearTimeout(timer);
  }
};

let draining = false;
export const markDraining = () => {
  draining = true;
};

/**
 * Readiness answers "should this instance receive traffic?", so only a dependency
 * the gateway cannot work without makes it unready. API key auth fails closed
 * without Postgres. Redis (fail-open) and Kafka (best-effort telemetry) are
 * reported as degraded, because the gateway still serves traffic without them.
 */
export const getReadiness = async () => {
  const [postgres, redisStatus] = await Promise.all([
    check(() => db.execute(sql`select 1`)),
    check(() => redis.ping()),
  ]);
  const kafka = getKafkaHealth();
  const kafkaStatus: CheckStatus = kafka.status === "connected" ? "up" : "down";

  const ready = !draining && postgres === "up";
  const degraded = redisStatus === "down" || kafkaStatus === "down";

  return {
    ready,
    status: !ready ? "unavailable" : degraded ? "degraded" : "ok",
    draining,
    checks: {
      postgres,
      redis: redisStatus,
      kafka: kafkaStatus,
    },
    telemetryBuffered: kafka.buffered,
  };
};
