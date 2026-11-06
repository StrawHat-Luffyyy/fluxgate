import { describe, expect, it, vi } from "vitest";

// This suite also runs under the integration config, which allows private targets.
vi.hoisted(() => {
  process.env.ALLOW_PRIVATE_TARGETS = "false";
});

import {
  assertPublicUrl,
  BlockedTargetError,
  guardedFetch,
  guardedLookup,
  isPrivateAddress,
} from "../../src/lib/ssrf.js";

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1",
    "127.1.2.3",
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "64:ff9b::a00:1",
    "64:ff9b:1::a00:1",
    "2002:a00:1::",
    "2001:0:4136:e378::1",
    "::a00:1",
    "fec0::1",
    "168.63.129.16",
    "not-an-ip",
  ])("blocks %s", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "11.0.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])(
    "allows %s",
    (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    },
  );
});

describe("assertPublicUrl", () => {
  it.each([
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://localhost/",
    "http://2130706433/", // 127.0.0.1 as a decimal integer
    "http://0x7f.0.0.1/",
    "http://0177.0.0.1/",
    "file:///etc/passwd",
    "ftp://example.com/",
    "gopher://example.com/",
    "http://user:pass@8.8.8.8/",
    "not a url",
  ])("rejects %s", async (url) => {
    await expect(assertPublicUrl(url)).rejects.toMatchObject({ code: "UNSAFE_TARGET_URL" });
  });

  it("accepts a public IP literal", async () => {
    await expect(assertPublicUrl("https://8.8.8.8/hook")).resolves.toBeInstanceOf(URL);
  });
});

describe("guardedFetch", () => {
  it("refuses a literal private IP without connecting", async () => {
    await expect(guardedFetch("http://127.0.0.1:59999/")).rejects.toBeInstanceOf(BlockedTargetError);
  });

  it("refuses a hostname that resolves to a private address at connection time", async () => {
    const error = await guardedFetch("http://localhost:59999/").catch((err: Error) => err);
    expect((error as Error & { cause?: unknown }).cause).toBeInstanceOf(BlockedTargetError);
  });
});

describe("guardedLookup", () => {
  const lookup = (hostname: string, all: boolean) =>
    new Promise<{ err: unknown; address: unknown }>((resolve) => {
      guardedLookup(hostname, { all }, (err, address) => resolve({ err, address }));
    });

  it("fails for a name resolving to loopback", async () => {
    const { err } = await lookup("localhost", true);
    expect(err).toBeInstanceOf(BlockedTargetError);
  });
});
