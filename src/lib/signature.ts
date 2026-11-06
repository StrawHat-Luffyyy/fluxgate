import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_TOLERANCE_SECONDS = 300;

const computeDigest = (secret: string, timestamp: number, body: string) =>
  createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

/**
 * Builds `t=<unix>,v1=<hex>`. The timestamp is inside the signed material, so a
 * captured request cannot be replayed outside the tolerance window.
 */
export const signPayload = (
  secret: string,
  body: string,
  timestamp = Math.floor(Date.now() / 1000),
) => `t=${timestamp},v1=${computeDigest(secret, timestamp, body)}`;

export const verifySignature = (
  header: string | undefined,
  secret: string,
  body: string,
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean => {
  if (!header) return false;

  const parts = new Map(
    header.split(",").map((part) => {
      const index = part.indexOf("=");
      return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
    }),
  );
  const timestamp = Number(parts.get("t"));
  const provided = parts.get("v1");

  if (!Number.isInteger(timestamp) || !provided) return false;
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;

  const expected = Buffer.from(computeDigest(secret, timestamp, body), "hex");
  const received = Buffer.from(provided, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
};
