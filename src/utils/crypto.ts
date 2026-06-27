import { randomBytes, createHash } from "node:crypto";

/**
 * Hashes a string using SHA-256.
 * We use SHA-256 over bcrypt for API keys because bcrypt is intentionally slow
 * (designed for passwords), whereas API keys need to be verified in milliseconds.
 */

export const hashKey = (key: string) => {
  return createHash("sha256").update(key).digest("hex");
};

/**
 * Generates a cryptographically secure, high-entropy API key.
 * Returns the raw key (to show the user ONCE), the hash (to store),
 * and a hint (to display in the UI later).
 */

export const generateApiKey = () => {
  const rawKey = `fg_live_${randomBytes(24).toString("hex")}`; // Generate 24 random bytes and convert to hex (48 characters)
  const hash = hashKey(rawKey); // Hash the raw key using SHA-256
  const hint = `${rawKey.slice(0, 12)}...${rawKey.slice(-4)}`; // Hint looks like: fg_live_abcd...9012

  return { rawKey, hash, hint };
};
