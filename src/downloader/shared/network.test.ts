import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildAuthHeaders,
  fetchWithAuthRedirects,
  fetchWithRetry,
  isSameOrigin,
  sanitizeHeaderValue,
} from "./network.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("authenticated downloader requests", () => {
  it("compares URL origins without trusting invalid input", () => {
    expect(isSameOrigin("https://video.example/a", "https://video.example/b")).toBe(true);
    expect(isSameOrigin("https://video.example", "https://cdn.example")).toBe(false);
    expect(isSameOrigin("not-a-url", "https://video.example")).toBe(false);
  });

  it("removes control characters from header values", () => {
    expect(sanitizeHeaderValue("token\r\n\t\0Injected:\u007f yes")).toBe("tokenInjected: yes");
  });

  it("sanitizes credentials for the trusted origin", () => {
    expect(
      buildAuthHeaders("https://video.example/master.m3u8", {
        referer: "https://course.example/lesson",
        cookies: "session=abc\r\nX-Evil: yes",
        authToken: "secret\nInjected",
      })
    ).toMatchObject({
      Origin: "https://course.example",
      Referer: "https://course.example/lesson",
      Cookie: "session=abcX-Evil: yes",
      APIKEY: "secretInjected",
      Authorization: "Bearer secretInjected",
    });
  });

  it("drops credentials for a different target origin", () => {
    const headers = buildAuthHeaders("https://attacker.example/master.m3u8", {
      credentialOrigin: "https://video.example",
      cookies: "session=abc",
      authToken: "secret",
    });

    expect(headers.Cookie).toBeUndefined();
    expect(headers.APIKEY).toBeUndefined();
    expect(headers.Authorization).toBeUndefined();
  });

  it("rebuilds headers without credentials after a cross-origin redirect", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example/master.m3u8" },
        })
      )
      .mockResolvedValueOnce(new Response("#EXTM3U", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchWithAuthRedirects("https://video.example/master.m3u8", {
      cookies: "session=abc",
      authToken: "secret",
    });

    const firstHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    const secondHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(firstHeaders.Cookie).toBe("session=abc");
    expect(secondHeaders.Cookie).toBeUndefined();
    expect(secondHeaders.Authorization).toBeUndefined();
  });

  it("stops redirect loops", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://video.example/master.m3u8" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchWithAuthRedirects("https://video.example/master.m3u8")).rejects.toThrow(
      "Redirect loop detected"
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("fetchWithRetry", () => {
  it("retries transient responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response("ready", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchWithRetry("https://video.example/config", {}, { retryDelayMs: 0 });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborts stalled requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new Error("Request timed out"));
          });
        });
      })
    );

    await expect(
      fetchWithRetry("https://video.example/stalled", {}, { retries: 0, timeoutMs: 5 })
    ).rejects.toBeDefined();
  });

  it("can time out response headers without aborting a slow response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const body = new ReadableStream<Uint8Array>({
          async start(controller) {
            await new Promise((resolve) => setTimeout(resolve, 25));
            controller.enqueue(new TextEncoder().encode("body"));
            controller.close();
          },
        });
        return new Response(body, { status: 200 });
      })
    );

    const response = await fetchWithRetry(
      "https://video.example/slow-body",
      {},
      { retries: 0, timeoutMs: 5, timeoutMode: "headers" }
    );

    await expect(response.text()).resolves.toBe("body");
  });
});
