import { EventEmitter } from "node:events";
import type { Page } from "playwright";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureLoomHls } from "./videoInterceptor.js";

class FakeCdpSession extends EventEmitter {
  send = vi.fn().mockResolvedValue({});
  detach = vi.fn().mockResolvedValue(undefined);
}

function createPage(client: FakeCdpSession, goto = vi.fn().mockResolvedValue(null)): Page {
  return {
    url: vi.fn().mockReturnValue("https://example.com/course"),
    context: vi.fn().mockReturnValue({
      newCDPSession: vi.fn().mockResolvedValue(client),
    }),
    goto,
    evaluate: vi.fn().mockResolvedValue(null),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    $: vi.fn().mockResolvedValue(null),
  } as unknown as Page;
}

async function waitForResponseListener(client: FakeCdpSession): Promise<void> {
  for (
    let attempt = 0;
    attempt < 10 && client.listenerCount("Network.responseReceived") === 0;
    attempt++
  ) {
    await Promise.resolve();
  }
}

describe("captureLoomHls", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a captured media playlist after a short master-playlist grace period", async () => {
    vi.useFakeTimers();
    const client = new FakeCdpSession();
    const page = createPage(client);

    const resultPromise = captureLoomHls(page, "abc123", 15000);
    await waitForResponseListener(client);
    client.emit("Network.responseReceived", {
      response: { url: "https://luna.loom.com/video/mediaplaylist-video-bitrate1000.m3u8" },
    });
    await vi.advanceTimersByTimeAsync(1000);

    await expect(resultPromise).resolves.toEqual({
      hlsUrl: "https://luna.loom.com/video/mediaplaylist-video-bitrate1000.m3u8",
    });
    expect(client.detach).toHaveBeenCalledOnce();
    expect(client.listenerCount("Network.responseReceived")).toBe(0);
  });

  it("prefers a master playlist that arrives during the grace period", async () => {
    vi.useFakeTimers();
    const client = new FakeCdpSession();
    const page = createPage(client);

    const resultPromise = captureLoomHls(page, "abc123", 15000);
    await waitForResponseListener(client);
    client.emit("Network.responseReceived", {
      response: { url: "https://luna.loom.com/video/mediaplaylist-video-bitrate1000.m3u8" },
    });
    await vi.advanceTimersByTimeAsync(500);
    client.emit("Network.responseReceived", {
      response: { url: "https://luna.loom.com/video/playlist.m3u8" },
    });

    await expect(resultPromise).resolves.toEqual({
      hlsUrl: "https://luna.loom.com/video/playlist.m3u8",
    });
    expect(client.detach).toHaveBeenCalledOnce();
    expect(client.listenerCount("Network.responseReceived")).toBe(0);
  });

  it("detaches the CDP session and listener when navigation fails", async () => {
    const client = new FakeCdpSession();
    const goto = vi
      .fn()
      .mockRejectedValueOnce(new Error("navigation failed"))
      .mockResolvedValueOnce(null);
    const page = createPage(client, goto);

    await expect(captureLoomHls(page, "abc123", 15000)).resolves.toEqual({
      hlsUrl: null,
      error: "HLS URL not captured",
    });
    expect(client.detach).toHaveBeenCalledOnce();
    expect(client.listenerCount("Network.responseReceived")).toBe(0);
  });
});
