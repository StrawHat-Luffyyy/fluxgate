import { describe, expect, it } from "vitest";
import { buildUpstreamUrl, remainingPathOf, routePrefixOf } from "../../src/proxy/path.js";

describe("routePrefixOf / remainingPathOf", () => {
  it.each([
    ["/gateway/users", "/users", ""],
    ["/gateway/users/", "/users", "/"],
    ["/gateway/users/1/posts", "/users", "/1/posts"],
    ["/gateway", "/", ""],
    ["/gateway/", "/", ""],
  ])("splits %s", (path, prefix, remaining) => {
    expect(routePrefixOf(path)).toBe(prefix);
    if (prefix !== "/") expect(remainingPathOf(path)).toBe(remaining);
  });
});

describe("buildUpstreamUrl", () => {
  it("joins base path and remainder", () => {
    expect(buildUpstreamUrl("https://api.example.com/v1", "/users", "")).toBe(
      "https://api.example.com/v1/users",
    );
  });

  it("handles a trailing slash on the base", () => {
    expect(buildUpstreamUrl("https://api.example.com/v1/", "/users", "")).toBe(
      "https://api.example.com/v1/users",
    );
  });

  it("keeps the query string", () => {
    expect(buildUpstreamUrl("https://api.example.com", "/users", "?a=1")).toBe(
      "https://api.example.com/users?a=1",
    );
  });

  it("cannot change the host with //host or @host", () => {
    expect(new URL(buildUpstreamUrl("https://api.example.com", "//evil.com/x", "")).host).toBe(
      "api.example.com",
    );
    expect(new URL(buildUpstreamUrl("https://api.example.com", "/@evil.com", "")).host).toBe(
      "api.example.com",
    );
    expect(new URL(buildUpstreamUrl("https://api.example.com", "/\\evil.com", "")).host).toBe(
      "api.example.com",
    );
  });

  it.each(["/../admin", "/%2e%2e/admin", "/x/../../admin"])(
    "refuses traversal out of the base path: %s",
    (remainder) => {
      expect(() => buildUpstreamUrl("https://api.example.com/v1", remainder, "")).toThrow(
        /escapes/,
      );
    },
  );

  it.each(["/..%2fadmin", "/..%2Fadmin", "/x%5c..%5cadmin"])(
    "refuses encoded separators under a base path: %s",
    (remainder) => {
      expect(() => buildUpstreamUrl("https://api.example.com/v1", remainder, "")).toThrow(/Encoded/);
    },
  );

  it("allows dot segments that stay inside the base path", () => {
    expect(buildUpstreamUrl("https://api.example.com/v1", "/a/../b", "")).toBe(
      "https://api.example.com/v1/b",
    );
  });
});
