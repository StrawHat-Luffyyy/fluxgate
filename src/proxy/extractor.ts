/**
 * One completed gateway request. This is the wire format of the Kafka topic and
 * the contract with ai-service, so renames must be made on both sides.
 */
export interface RequestFeatures {
  requestId: string;
  tenantId: string;
  apiKeyId: string;
  method: string;
  path: string;
  routePrefix: string;
  clientIp: string;
  requestByteSize: number;
  responseByteSize: number;
  statusCode: number;
  /** Time until upstream response headers: excludes the client's download speed. */
  latencyMs: number;
  rateLimited: boolean;
  /** False when the gateway answered itself (404, 429, 502): nothing to score. */
  upstreamCalled: boolean;
  timestamp: number;
}

export const parseContentLength = (value: string | undefined | null): number => {
  // The header is client-controlled: an absurd value must not reach the database,
  // where an out-of-range bigint would fail the insert.
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isNaN(parsed) || parsed < 0) return 0;
  return Math.min(parsed, Number.MAX_SAFE_INTEGER);
};
