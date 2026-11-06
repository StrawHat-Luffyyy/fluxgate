import { describe, expect, it } from "vitest";
import app from "../../src/app.js";
import {
  createRequestContext,
  currentTraceHeaders,
  runWithRequestContext,
} from "../../src/lib/requestContext.js";

const VALID = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

describe("createRequestContext", () => {
  it("continues a valid inbound trace", () => {
    const context = createRequestContext("req", { traceparent: VALID, tracestate: "a=1" });
    expect(context.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(context.traceparent).toBe(VALID);
    expect(context.tracestate).toBe("a=1");
  });

  it.each([
    ["garbage", "not-a-traceparent"],
    ["log injection", `00-${"a".repeat(32)}-${"b".repeat(16)}-01\n{"level":"fatal"}`],
    ["all-zero trace id", `00-${"0".repeat(32)}-${"b".repeat(16)}-01`],
    ["all-zero parent id", `00-${"a".repeat(32)}-${"0".repeat(16)}-01`],
    ["forbidden version", `ff-${"a".repeat(32)}-${"b".repeat(16)}-01`],
  ])("starts a new sampled trace for %s", (_name, traceparent) => {
    const context = createRequestContext("req", { traceparent });
    expect(context.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(context.traceId).not.toBe("a".repeat(32));
  });

  it("drops an oversized tracestate", () => {
    const context = createRequestContext("req", { traceparent: VALID, tracestate: "a".repeat(513) });
    expect(context.tracestate).toBeUndefined();
  });

  it("drops tracestate along with an invalid traceparent", () => {
    expect(createRequestContext("req", { traceparent: "bad", tracestate: "a=1" }).tracestate).toBeUndefined();
  });
});

describe("currentTraceHeaders", () => {
  it("is empty outside a request and carries the trace inside one", () => {
    expect(currentTraceHeaders()).toEqual({});
    const context = createRequestContext("req", { traceparent: VALID });
    expect(runWithRequestContext(context, currentTraceHeaders)).toEqual({ traceparent: VALID });
  });
});

describe("HTTP responses", () => {
  it("ignore a client's trace id and request id", async () => {
    const res = await app.request("/health/live", {
      headers: { traceparent: VALID, "x-request-id": "client-chosen" },
    });
    expect(res.headers.get("x-trace-id")).not.toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(res.headers.get("x-request-id")).not.toBe("client-chosen");
  });

  it("continue the trace on an alert from ai-service", async () => {
    const res = await app.request("/internal/alerts", {
      method: "POST",
      headers: { traceparent: VALID },
      body: "{}",
    });
    expect(res.status).toBe(401); // Unsigned, and rejected before anything is stored.
    expect(res.headers.get("x-trace-id")).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
  });

  it("generate a trace id when the client sends none", async () => {
    const res = await app.request("/health/live");
    expect(res.headers.get("x-trace-id")).toMatch(/^[0-9a-f]{32}$/);
  });
});
