import type { RequestHeaders } from "./types.js";

const RETRYABLE_STATUS_CODES = new Set([408, 413, 429, 500, 502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 2;

export interface FetchWithRetryOptions {
  timeoutMs?: number | undefined;
  retries?: number | undefined;
  retryDelayMs?: number | undefined;
}

export interface AuthHeaderOptions {
  referer?: string | undefined;
  cookies?: string | undefined;
  authToken?: string | undefined;
  credentialOrigin?: string | undefined;
  accept?: string | undefined;
}

export interface AuthenticatedFetchOptions extends AuthHeaderOptions, FetchWithRetryOptions {
  method?: string | undefined;
  maxRedirects?: number | undefined;
}

/** Removes characters that could inject additional HTTP headers. */
export function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]/g, "").trim();
}

export function isSameOrigin(firstUrl: string, secondUrl: string): boolean {
  try {
    return new URL(firstUrl).origin === new URL(secondUrl).origin;
  } catch {
    return false;
  }
}

/**
 * Builds the shared HLS auth headers while limiting secrets to the origin that
 * originally received them.
 */
export function buildAuthHeaders(
  targetUrl: string,
  options: AuthHeaderOptions = {}
): RequestHeaders {
  const target = new URL(targetUrl);
  const referer = new URL(options.referer ?? `${target.origin}/`);
  const credentialOrigin = new URL(options.credentialOrigin ?? target.origin).origin;
  const headers: RequestHeaders = {
    Origin: sanitizeHeaderValue(referer.origin),
    Referer: sanitizeHeaderValue(referer.href),
    Accept: options.accept ?? "*/*",
  };

  if (target.origin !== credentialOrigin) {
    return headers;
  }

  if (options.cookies) {
    headers.Cookie = sanitizeHeaderValue(options.cookies);
  }
  if (options.authToken) {
    const authToken = sanitizeHeaderValue(options.authToken);
    headers.APIKEY = authToken;
    headers.Authorization = `Bearer ${authToken}`;
  }

  return headers;
}

/** Fetches with a bounded timeout and retries transient HTTP/network failures. */
export async function fetchWithRetry(
  input: string | URL | Request,
  init: RequestInit = {},
  options: FetchWithRetryOptions = {}
): Promise<Response> {
  const retries = options.retries ?? DEFAULT_RETRIES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? 250;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;

    try {
      const response = await fetch(input, { ...init, signal });
      if (!RETRYABLE_STATUS_CODES.has(response.status) || attempt === retries) {
        return response;
      }
      await response.body?.cancel().catch(() => undefined);
      lastError = new Error(`Transient HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (init.signal?.aborted || attempt === retries) throw error;
    }

    await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
  }

  throw lastError instanceof Error ? lastError : new Error("Request failed");
}

/**
 * Follows redirects manually so credentials can be rebuilt for each target.
 * Cross-origin redirects keep ordinary request headers but lose cookies/tokens.
 */
export async function fetchWithAuthRedirects(
  url: string,
  options: AuthenticatedFetchOptions = {}
): Promise<Response> {
  const credentialOrigin = new URL(options.credentialOrigin ?? url).origin;
  const maxRedirects = options.maxRedirects ?? 3;
  const visited = new Set<string>();
  let currentUrl = new URL(url).href;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    if (visited.has(currentUrl)) {
      throw new Error(`Redirect loop detected for ${currentUrl}`);
    }
    visited.add(currentUrl);

    const headers = buildAuthHeaders(currentUrl, { ...options, credentialOrigin });
    const response = await fetchWithRetry(
      currentUrl,
      {
        ...(options.method ? { method: options.method } : {}),
        headers: headers as HeadersInit,
        redirect: "manual",
      },
      options
    );

    if (response.status < 300 || response.status >= 400) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location) return response;
    currentUrl = new URL(location, currentUrl).href;
  }

  throw new Error(`Too many redirects for ${url}`);
}
