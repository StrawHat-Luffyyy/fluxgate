import { BlockList, isIP } from "node:net";
import { lookup as dnsLookup, promises as dns, type LookupAddress } from "node:dns";
import { Agent, fetch as undiciFetch, type RequestInit } from "undici";
import { env } from "../config/env.js";
import { AppError } from "./AppError.js";

const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // includes the cloud metadata endpoint 169.254.169.254
  ["168.63.129.16", 32], // Azure platform DNS and metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::", 96], // Deprecated IPv4-compatible addresses
  // Transition mechanisms can embed a private IPv4 address.
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["2001::", 32],
  ["2002::", 16],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(network, prefix, "ipv6");
}

export const isPrivateAddress = (address: string): boolean => {
  const family = isIP(address);
  if (family === 0) return true; // Not an IP: refuse rather than guess.
  return blocked.check(address, family === 4 ? "ipv4" : "ipv6");
};

const invalid = (message: string) => AppError.badRequest(message, "UNSAFE_TARGET_URL");

const parseTarget = (rawUrl: string): URL => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw invalid("URL is not valid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw invalid("URL must use http or https");
  }
  if (url.username || url.password) {
    throw invalid("URL must not contain credentials");
  }
  return url;
};

const hostOf = (url: URL) => url.hostname.replace(/^\[|\]$/g, "");

/**
 * Config-time check used when a tenant saves a URL, so that mistakes fail with a
 * clear error. It cannot stop DNS rebinding on its own: see `guardedFetch`.
 */
export const assertPublicUrl = async (rawUrl: string): Promise<URL> => {
  const url = parseTarget(rawUrl);
  if (env.ALLOW_PRIVATE_TARGETS) return url;

  const host = hostOf(url);
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw invalid("URL resolves to a private address");
    return url;
  }
  let addresses: { address: string }[];
  try {
    addresses = await dns.lookup(host, { all: true });
  } catch {
    throw invalid("URL host could not be resolved");
  }
  if (addresses.some(({ address }) => isPrivateAddress(address))) {
    throw invalid("URL resolves to a private address");
  }
  return url;
};

export class BlockedTargetError extends Error {
  constructor(host: string) {
    super(`Blocked connection to private address for host ${host}`);
    this.name = "BlockedTargetError";
  }
}

/**
 * Resolves at connection time and refuses private addresses. Checking inside the
 * socket's own lookup closes the DNS-rebinding window between check and connect.
 */
export const guardedLookup = (
  hostname: string,
  options: { all?: boolean },
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void,
) => {
  dnsLookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err, "");
    if (addresses.some(({ address }) => isPrivateAddress(address))) {
      return callback(new BlockedTargetError(hostname), "");
    }
    if (options.all) return callback(null, addresses);
    const [first] = addresses;
    return callback(null, first.address, first.family);
  });
};

const dispatcher = new Agent({
  headersTimeout: env.UPSTREAM_TIMEOUT_MS,
  bodyTimeout: env.UPSTREAM_TIMEOUT_MS,
  keepAliveTimeout: 10_000,
  connections: 256,
  connect: env.ALLOW_PRIVATE_TARGETS ? {} : { lookup: guardedLookup as never },
});

/**
 * All outbound requests to tenant-supplied URLs go through here. Redirects are
 * never followed: a public URL could otherwise redirect to a private one.
 */
export const guardedFetch = (rawUrl: string, init: RequestInit = {}) => {
  const url = parseTarget(rawUrl);
  // Socket lookup is skipped for literal IPs, so they are checked here.
  const host = hostOf(url);
  if (!env.ALLOW_PRIVATE_TARGETS && isIP(host) && isPrivateAddress(host)) {
    return Promise.reject(new BlockedTargetError(host));
  }
  return undiciFetch(url, { redirect: "manual", ...init, dispatcher });
};

export const closeOutboundConnections = () => dispatcher.close();
