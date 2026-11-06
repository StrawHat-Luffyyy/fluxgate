import { DEMO_API_KEY, DEMO_ROUTE_PREFIXES } from "./constants.js";

// Sends ordinary traffic through the real gateway with a real API key, plus what the
// demo exists to show: an oversized response the model flags, and bursts past the rate
// limit. Everything these requests produce is genuine pipeline output.

const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost:3000";
const REQUEST_INTERVAL_MS = 2_000;
const OUTLIER_EVERY_MS = 300_000;
const BURST_EVERY_MS = 600_000;
const BURST_SIZE = 150;

let stopping = false;
process.on("SIGTERM", () => (stopping = true));
process.on("SIGINT", () => (stopping = true));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const pick = <T>(items: T[]) => items[Math.floor(Math.random() * items.length)];

const send = async (path: string, init: RequestInit = {}) => {
  const res = await fetch(`${GATEWAY_URL}/gateway${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${DEMO_API_KEY}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  await res.arrayBuffer();
  return res.status;
};

const ordinaryRequest = () => {
  const prefix = pick(DEMO_ROUTE_PREFIXES);
  const roll = Math.random();
  if (roll < 0.03) return send(`${prefix}/fail`);
  if (roll < 0.25) {
    return send(`${prefix}/items`, {
      method: "POST",
      body: JSON.stringify({ note: "x".repeat(200 + Math.floor(Math.random() * 1000)) }),
    });
  }
  return send(`${prefix}/items/${Math.floor(Math.random() * 1000)}`);
};

let nextOutlier = Date.now() + 15_000;
let nextBurst = Date.now() + 45_000;

while (!stopping) {
  try {
    if (Date.now() >= nextOutlier) {
      nextOutlier = Date.now() + OUTLIER_EVERY_MS;
      await send(`${pick(DEMO_ROUTE_PREFIXES)}/huge`);
    } else if (Date.now() >= nextBurst) {
      nextBurst = Date.now() + BURST_EVERY_MS;
      await Promise.allSettled(Array.from({ length: BURST_SIZE }, ordinaryRequest));
    } else {
      await ordinaryRequest();
    }
  } catch (err) {
    process.stderr.write(`Request failed: ${(err as Error).message}\n`);
  }
  await sleep(REQUEST_INTERVAL_MS);
}
