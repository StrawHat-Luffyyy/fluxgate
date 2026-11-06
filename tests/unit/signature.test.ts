import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signPayload, verifySignature } from "../../src/lib/signature.js";
import { decryptSecret, encryptSecret } from "../../src/lib/secretBox.js";

const SECRET = "test-secret-test-secret";

describe("signPayload / verifySignature", () => {
  it("produces the documented format, independently verifiable", () => {
    const signature = signPayload(SECRET, "body", 1700000000);
    const expected = createHmac("sha256", SECRET).update("1700000000.body").digest("hex");
    expect(signature).toBe(`t=1700000000,v1=${expected}`);
  });

  it("accepts a fresh signature", () => {
    expect(verifySignature(signPayload(SECRET, "body"), SECRET, "body")).toBe(true);
  });

  it("rejects a changed body, a wrong secret, and an altered timestamp", () => {
    const signature = signPayload(SECRET, "body", 1700000000);
    const now = 1700000000;
    expect(verifySignature(signature, SECRET, "body2", 300, now)).toBe(false);
    expect(verifySignature(signature, "other", "body", 300, now)).toBe(false);
    expect(verifySignature(signature.replace("t=1700000000", "t=1700000001"), SECRET, "body", 300, now)).toBe(false);
  });

  it("enforces the tolerance window in both directions", () => {
    const signature = signPayload(SECRET, "body", 1700000000);
    expect(verifySignature(signature, SECRET, "body", 300, 1700000300)).toBe(true);
    expect(verifySignature(signature, SECRET, "body", 300, 1700000301)).toBe(false);
    expect(verifySignature(signature, SECRET, "body", 300, 1699999699)).toBe(false);
  });

  it.each([undefined, "", "garbage", "t=abc,v1=def", "t=1700000000", "v1=abcd", "t=1700000000,v1="])(
    "rejects malformed header %s",
    (header) => {
      expect(verifySignature(header, SECRET, "body", 300, 1700000000)).toBe(false);
    },
  );
});

describe("secretBox", () => {
  it("round-trips, and encrypts differently each time", () => {
    const a = encryptSecret("whsec_abc");
    const b = encryptSecret("whsec_abc");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("whsec_abc");
  });

  it("rejects tampered ciphertext", () => {
    const raw = Buffer.from(encryptSecret("whsec_abc"), "base64");
    raw[raw.length - 1] ^= 1;
    expect(() => decryptSecret(raw.toString("base64"))).toThrow();
  });
});
