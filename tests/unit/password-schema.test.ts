import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/db/index.js", () => ({ db: {}, analyticsDb: {} }));
vi.mock("../../src/redis/client.js", () => ({ redis: {} }));

const { newPassword } = await import("../../src/routes/auth.js");

describe("newPassword", () => {
  it("accepts up to 72 bytes", () => {
    expect(newPassword.safeParse("a".repeat(72)).success).toBe(true);
    expect(newPassword.safeParse("é".repeat(36)).success).toBe(true);
  });

  it("counts bytes, because bcrypt ignores whatever is past 72 of them", () => {
    expect(newPassword.safeParse("a".repeat(73)).success).toBe(false);
    // 37 characters, but 74 bytes.
    expect(newPassword.safeParse("é".repeat(37)).success).toBe(false);
  });

  it("still requires 10 characters", () => {
    expect(newPassword.safeParse("a".repeat(9)).success).toBe(false);
    expect(newPassword.safeParse("a".repeat(10)).success).toBe(true);
  });
});
