import type { Context } from "hono";

export interface RequestFeatures {
  tenantId: string;
  method: string;
  path: string;
  clientIp: string;
  requestByteBySize: number;
  responseByteBySize: number;
  statusCode: number;
  latencyMs: number;
  timestamp: number;
}

/**
 * Extracts numerical features from the completed request/response lifecycle.
 */

export const extractFeatures = (
  c: Context,
  tenantId: string,
  statusCode: number,
  responseSize: number,
  startTime: number,
): RequestFeatures => {
  const reqContentLength = c.req.header("Content-Length");
  const requestByteSize = reqContentLength ? parseInt(reqContentLength, 10) : 0;

  const clientIp =
    c.req.header("x-forwarded-for") ||
    c.req.header("cf-connecting-ip") ||
    "127.0.0.1";
  return {
    tenantId,
    method: c.req.method,
    path: c.req.path,
    clientIp,
    requestByteBySize: isNaN(requestByteSize) ? 0 : requestByteSize,
    responseByteBySize: responseSize,
    statusCode,
    latencyMs: Date.now() - startTime,
    timestamp: startTime,
  };
};
