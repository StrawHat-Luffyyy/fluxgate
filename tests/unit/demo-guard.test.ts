import { describe, expect, it } from "vitest";
import { assertLocalDatabase } from "../../src/demo/guard.js";

describe("assertLocalDatabase", () => {
  it.each([
    "postgresql://u:p@localhost:5432/fluxgate",
    "postgresql://u:p@127.0.0.1/fluxgate",
    "postgresql://u:p@[::1]:5432/fluxgate",
  ])("allows %s", (url) => {
    expect(() => assertLocalDatabase(url, false)).not.toThrow();
  });

  it("treats the compose hostname as local only in demo mode", () => {
    const url = "postgresql://u:p@postgres:5432/fluxgate";
    expect(() => assertLocalDatabase(url, true)).not.toThrow();
    expect(() => assertLocalDatabase(url, false)).toThrow(/non-local/);
  });

  it("refuses a multi-host URL even in demo mode", () => {
    expect(() => assertLocalDatabase("postgresql://u:p@localhost,db.example.com/x", true)).toThrow();
  });

  it.each([
    "postgresql://u:p@ep-example.neon.tech/fluxgate",
    "postgresql://u:p@db.example.com:5432/localhost",
    "postgresql://localhost:secret@evil.example.com/fluxgate",
    "postgresql://u:p@localhost.evil.example.com/fluxgate",
  ])("refuses %s", (url) => {
    expect(() => assertLocalDatabase(url)).toThrow(/non-local/);
  });

  it("does not print the password in the refusal", () => {
    expect(() => assertLocalDatabase("postgresql://u:hunter2@db.example.com/x")).toThrow(
      expect.not.objectContaining({ message: expect.stringContaining("hunter2") }),
    );
  });
});
