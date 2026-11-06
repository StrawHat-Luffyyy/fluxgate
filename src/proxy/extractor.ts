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
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
};
