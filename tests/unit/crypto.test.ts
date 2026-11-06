import { describe, it, expect } from "vitest";
import { generateApiKey, hashKey } from "../../src/utils/crypto.js";

describe("Crypto Utilities", () => {
  it("should generate a raw key that starts with the live prefix", () => {
    const apiKey = generateApiKey();

    expect(apiKey).toBeDefined();
    expect(apiKey.rawKey).toBeDefined();
    expect(apiKey.rawKey.startsWith("fg_live_")).toBe(true);
  });
});
describe("hashKey", () => {
  it("should always return the same determinstic SHA-256 hash output for a given input", () => {
    const input = "test";

    const hashAttempts1 = hashKey(input);
    const hashAttempts2 = hashKey(input);

    expect(hashAttempts1).toBe(hashAttempts2);

    expect(hashAttempts1).toBeDefined();
    expect(hashAttempts1.length).toBe(64);
  });
});
