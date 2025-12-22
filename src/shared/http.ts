import ky from "ky";

/**
 * Default User-Agent for HTTP requests.
 * Mimics a standard Chrome browser on macOS.
 */
export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Pre-configured HTTP client with sensible defaults.
 * Uses ky for automatic retries, better error handling, and cleaner API.
 */
export const http = ky.create({
  headers: {
    "User-Agent": USER_AGENT,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
  },
  timeout: 30000,
  retry: {
    limit: 2,
    statusCodes: [408, 413, 429, 500, 502, 503, 504],
  },
});

/**
 * HTTP client configured for JSON APIs.
 */
export const httpJson = http.extend({
  headers: {
    Accept: "application/json",
  },
});
