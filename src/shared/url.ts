/**
 * Generic URL utilities for parsing and manipulation.
 */

/**
 * Extracts the query string from a URL (including the leading ?).
 * Returns empty string if no query params exist.
 *
 * @example
 * extractQueryParams("https://example.com/path?foo=bar&baz=1")
 * // => "?foo=bar&baz=1"
 */
export function extractQueryParams(url: string): string {
  const queryStart = url.indexOf("?");
  return queryStart !== -1 ? url.substring(queryStart) : "";
}

/**
 * Gets the base URL (everything up to and including the last slash).
 * Useful for resolving relative URLs.
 *
 * @example
 * getBaseUrl("https://example.com/videos/playlist.m3u8")
 * // => "https://example.com/videos/"
 */
export function getBaseUrl(url: string): string {
  return url.substring(0, url.lastIndexOf("/") + 1);
}

/**
 * Resolves a potentially relative URI against a base URL.
 * If the URI is already absolute (starts with http), returns it unchanged.
 *
 * @example
 * resolveUrl("segment001.ts", "https://cdn.example.com/videos/")
 * // => "https://cdn.example.com/videos/segment001.ts"
 *
 * resolveUrl("https://other.com/file.ts", "https://cdn.example.com/videos/")
 * // => "https://other.com/file.ts"
 */
export function resolveUrl(uri: string, baseUrl: string): string {
  return uri.startsWith("http") ? uri : baseUrl + uri;
}

/**
 * Resolves a URI and appends query params for authentication.
 * Useful for signed URLs where auth tokens need to be preserved.
 *
 * @example
 * resolveUrlWithParams("segment.ts", "https://cdn.com/", "?token=abc")
 * // => "https://cdn.com/segment.ts?token=abc"
 */
export function resolveUrlWithParams(uri: string, baseUrl: string, queryParams: string): string {
  const resolved = resolveUrl(uri, baseUrl);
  // Don't add params if URL already has them
  return resolved.includes("?") ? resolved : resolved + queryParams;
}
