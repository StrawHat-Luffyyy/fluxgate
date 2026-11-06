import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { env } from "../config/env.js";

/**
 * X-Forwarded-For is client-controlled unless a trusted proxy appends to it, so
 * it is only read when TRUST_PROXY is set. The last entry is the one that proxy
 * added; anything to its left may be spoofed.
 */
export const clientIpOf = (c: Context): string => {
  if (env.TRUST_PROXY) {
    const forwarded = c.req.header("x-forwarded-for");
    const last = forwarded?.split(",").pop()?.trim();
    if (last) return last;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown"; // No socket, e.g. in-process app.request().
  }
};
