import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import app from "../../src/app.js";

const spec = JSON.parse(readFileSync(new URL("../../docs/openapi.json", import.meta.url), "utf8")) as {
  openapi: string;
  paths: Record<string, Record<string, unknown>>;
};

const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

// "/gateway/*" is one documented template: the proxy accepts every method and depth.
const GATEWAY_TEMPLATE = "/gateway/{path}";

const toOpenApiPath = (path: string) => path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");

const appOperations = new Set(
  app.routes
    .filter((r) => r.method !== "ALL" && !r.path.includes("*"))
    .map((r) => `${r.method.toLowerCase()} ${toOpenApiPath(r.path)}`),
);

const specOperations = new Set(
  Object.entries(spec.paths)
    .filter(([path]) => path !== GATEWAY_TEMPLATE)
    .flatMap(([path, item]) =>
      Object.keys(item)
        .filter((key) => HTTP_METHODS.includes(key))
        .map((method) => `${method} ${path}`),
    ),
);

describe("docs/openapi.json", () => {
  it("is OpenAPI 3.1", () => {
    expect(spec.openapi).toMatch(/^3\.1\./);
  });

  it("documents every route the app serves", () => {
    const missing = [...appOperations].filter((op) => !specOperations.has(op));
    expect(missing).toEqual([]);
  });

  it("documents no route the app does not serve", () => {
    const extra = [...specOperations].filter((op) => !appOperations.has(op));
    expect(extra).toEqual([]);
  });

  it("documents the gateway as one path template", () => {
    expect(spec.paths[GATEWAY_TEMPLATE]).toBeDefined();
    expect(app.routes.some((r) => r.path === "/gateway/*")).toBe(true);
  });

  it("finds routes to compare", () => {
    expect(appOperations.size).toBeGreaterThan(20);
  });
});
