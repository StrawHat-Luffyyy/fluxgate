import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "../config/env.js";

const key = createHash("sha256").update(env.SECRETS_ENCRYPTION_KEY).digest();

/**
 * Webhook signing secrets must be recoverable to sign payloads, so they are
 * encrypted rather than hashed. Format: base64(iv | tag | ciphertext).
 */
export const encryptSecret = (plaintext: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
};

export const decryptSecret = (encoded: string): string => {
  const raw = Buffer.from(encoded, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
};
