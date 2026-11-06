import { AppError } from "../lib/AppError.js";

const GATEWAY_MOUNT = /^\/gateway/;

/** `/gateway/users/1` -> `/users` */
export const routePrefixOf = (requestPath: string): string => {
  const path = requestPath.replace(GATEWAY_MOUNT, "");
  return `/${path.split("/")[1] ?? ""}`;
};

/** `/gateway/users/1` -> `/1` */
export const remainingPathOf = (requestPath: string): string => {
  const path = requestPath.replace(GATEWAY_MOUNT, "");
  return path.slice(routePrefixOf(requestPath).length);
};

/**
 * Appends the request's remaining path to the target's own path.
 *
 * Passing the remainder to `new URL(remaining, base)` is unsafe: `//evil.com/x`
 * replaces the host, and an absolute path discards the base path. Assigning to
 * `pathname` cannot change the host. Dot segments are normalised by the URL
 * parser, so the result is checked to still be inside the target's path.
 */
export const buildUpstreamUrl = (
  targetBaseUrl: string,
  remainingPath: string,
  search: string,
): string => {
  const url = new URL(targetBaseUrl);
  const basePath = url.pathname.replace(/\/+$/, "");

  // The URL parser leaves these encoded, but an upstream that decodes before
  // normalising would treat `/..%2fadmin` as a traversal out of the base path.
  if (basePath && /%2f|%5c/i.test(remainingPath)) {
    throw AppError.badRequest("Encoded path separators are not allowed", "INVALID_UPSTREAM_PATH");
  }

  url.pathname = `${basePath}${remainingPath}`;
  url.search = search;

  if (basePath && url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) {
    throw AppError.badRequest("Path escapes the upstream base path", "INVALID_UPSTREAM_PATH");
  }
  return url.toString();
};
