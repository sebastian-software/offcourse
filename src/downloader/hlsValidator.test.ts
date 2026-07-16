import type { Page } from "playwright";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  extractLoomId: vi.fn(),
  getLoomVideoInfoDetailed: vi.fn(),
  extractVimeoId: vi.fn(),
  getVimeoVideoInfo: vi.fn(),
  getVimeoVideoInfoFromBrowser: vi.fn(),
  captureLoomHls: vi.fn(),
  captureVimeoConfig: vi.fn(),
}));

vi.mock("./loomDownloader.js", () => ({
  extractLoomId: mocks.extractLoomId,
  getLoomVideoInfoDetailed: mocks.getLoomVideoInfoDetailed,
}));

vi.mock("./vimeoDownloader.js", () => ({
  extractVimeoId: mocks.extractVimeoId,
  getVimeoVideoInfo: mocks.getVimeoVideoInfo,
  getVimeoVideoInfoFromBrowser: mocks.getVimeoVideoInfoFromBrowser,
}));

vi.mock("../scraper/videoInterceptor.js", () => ({
  captureLoomHls: mocks.captureLoomHls,
  captureVimeoConfig: mocks.captureVimeoConfig,
}));

import { validateLoomHls, validateVideoHls, validateVimeoVideo } from "./hlsValidator.js";

const page = {} as Page;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.extractLoomId.mockReturnValue("loom-id");
  mocks.extractVimeoId.mockReturnValue("vimeo-id");
});

describe("validateLoomHls", () => {
  it("rejects invalid Loom URLs before fetching", async () => {
    mocks.extractLoomId.mockReturnValue(null);

    await expect(validateLoomHls("not-loom")).resolves.toMatchObject({
      isValid: false,
      hlsUrl: null,
      errorCode: "INVALID_URL",
    });
    expect(mocks.getLoomVideoInfoDetailed).not.toHaveBeenCalled();
  });

  it("returns the direct API HLS stream", async () => {
    mocks.getLoomVideoInfoDetailed.mockResolvedValue({
      success: true,
      info: { hlsUrl: "https://cdn.example/loom.m3u8" },
    });

    await expect(validateLoomHls("https://loom.com/share/loom-id")).resolves.toEqual({
      isValid: true,
      hlsUrl: "https://cdn.example/loom.m3u8",
    });
  });

  it("falls back to browser interception when direct HLS discovery fails", async () => {
    mocks.getLoomVideoInfoDetailed.mockResolvedValue({
      success: false,
      error: "No HLS URL",
      errorCode: "HLS_NOT_FOUND",
    });
    mocks.captureLoomHls.mockResolvedValue({ hlsUrl: "https://cdn.example/captured.m3u8" });

    await expect(validateLoomHls("https://loom.com/share/loom-id", page)).resolves.toEqual({
      isValid: true,
      hlsUrl: "https://cdn.example/captured.m3u8",
      details: "Captured via network interception",
    });
    expect(mocks.captureLoomHls).toHaveBeenCalledWith(page, "loom-id", 15000);
  });

  it("preserves the direct error when browser interception finds no HLS stream", async () => {
    mocks.getLoomVideoInfoDetailed.mockResolvedValue({
      success: false,
      error: "No HLS URL",
      errorCode: "HLS_NOT_FOUND",
      details: "Embed response contained no stream",
    });
    mocks.captureLoomHls.mockResolvedValue({ hlsUrl: null });

    await expect(validateLoomHls("https://loom.com/share/loom-id", page)).resolves.toEqual({
      isValid: false,
      hlsUrl: null,
      error: "No HLS URL",
      errorCode: "HLS_NOT_FOUND",
      details: "Embed response contained no stream",
    });
  });

  it("preserves structured direct-fetch failures", async () => {
    mocks.getLoomVideoInfoDetailed.mockResolvedValue({
      success: false,
      error: "Private video",
      errorCode: "EMBED_FETCH_FAILED",
      details: "HTTP 403",
    });

    await expect(validateLoomHls("https://loom.com/share/loom-id")).resolves.toEqual({
      isValid: false,
      hlsUrl: null,
      error: "Private video",
      errorCode: "EMBED_FETCH_FAILED",
      details: "HTTP 403",
    });
  });

  it("supplies a default error for an unstructured direct-fetch failure", async () => {
    mocks.getLoomVideoInfoDetailed.mockResolvedValue({ success: false });

    await expect(validateLoomHls("https://loom.com/share/loom-id")).resolves.toEqual({
      isValid: false,
      hlsUrl: null,
      error: "Failed to fetch Loom video info",
    });
  });
});

describe("validateVimeoVideo", () => {
  it("rejects invalid Vimeo URLs before fetching", async () => {
    mocks.extractVimeoId.mockReturnValue(null);

    await expect(validateVimeoVideo("not-vimeo")).resolves.toMatchObject({
      isValid: false,
      hlsUrl: null,
      errorCode: "INVALID_URL",
    });
    expect(mocks.getVimeoVideoInfo).not.toHaveBeenCalled();
  });

  it("returns HLS and progressive direct streams", async () => {
    mocks.getVimeoVideoInfo
      .mockResolvedValueOnce({
        success: true,
        info: { hlsUrl: "https://cdn.example/vimeo.m3u8", progressiveUrl: null },
      })
      .mockResolvedValueOnce({
        success: true,
        info: { hlsUrl: null, progressiveUrl: "https://cdn.example/vimeo.mp4" },
      });

    await expect(validateVimeoVideo("https://vimeo.com/123")).resolves.toMatchObject({
      isValid: true,
      hlsUrl: "https://cdn.example/vimeo.m3u8",
    });
    await expect(validateVimeoVideo("https://vimeo.com/456")).resolves.toMatchObject({
      isValid: true,
      hlsUrl: "https://cdn.example/vimeo.mp4",
    });
  });

  it("passes unlisted hashes and lesson referers to the direct fetch", async () => {
    mocks.getVimeoVideoInfo.mockResolvedValue({
      success: true,
      info: { hlsUrl: "https://cdn.example/vimeo.m3u8", progressiveUrl: null },
    });

    await validateVimeoVideo(
      "https://vimeo.com/123/abc123",
      undefined,
      "https://course.example/lesson"
    );

    await validateVimeoVideo(
      "https://player.vimeo.com/video/123?h=def456",
      undefined,
      "https://course.example/embed"
    );

    expect(mocks.getVimeoVideoInfo).toHaveBeenNthCalledWith(
      1,
      "vimeo-id",
      "abc123",
      "https://course.example/lesson"
    );
    expect(mocks.getVimeoVideoInfo).toHaveBeenNthCalledWith(
      2,
      "vimeo-id",
      "def456",
      "https://course.example/embed"
    );
  });

  it("uses an authenticated browser for private videos", async () => {
    mocks.getVimeoVideoInfo.mockResolvedValue({
      success: false,
      errorCode: "PRIVATE_VIDEO",
    });
    mocks.getVimeoVideoInfoFromBrowser.mockResolvedValue({
      success: true,
      info: { hlsUrl: "https://cdn.example/private.m3u8", progressiveUrl: null },
    });

    await expect(validateVimeoVideo("https://vimeo.com/123", page)).resolves.toMatchObject({
      isValid: true,
      hlsUrl: "https://cdn.example/private.m3u8",
    });
    expect(mocks.captureVimeoConfig).not.toHaveBeenCalled();
  });

  it("falls back to the running player after both config fetches fail", async () => {
    mocks.getVimeoVideoInfo.mockResolvedValue({
      success: false,
      errorCode: "PRIVATE_VIDEO",
    });
    mocks.getVimeoVideoInfoFromBrowser.mockResolvedValue({
      success: false,
      errorCode: "PRIVATE_VIDEO",
    });
    mocks.captureVimeoConfig.mockResolvedValue({
      hlsUrl: null,
      progressiveUrl: "https://cdn.example/captured.mp4",
    });

    await expect(validateVimeoVideo("https://vimeo.com/123", page)).resolves.toEqual({
      isValid: true,
      hlsUrl: "https://cdn.example/captured.mp4",
      details: "Extracted from running player",
    });
    expect(mocks.captureVimeoConfig).toHaveBeenCalledWith(page, "vimeo-id", 20000);
  });

  it("preserves the private-video error when every browser fallback is exhausted", async () => {
    mocks.getVimeoVideoInfo.mockResolvedValue({
      success: false,
      error: "Private video",
      errorCode: "PRIVATE_VIDEO",
    });
    mocks.getVimeoVideoInfoFromBrowser.mockResolvedValue({
      success: false,
      error: "Private video in browser",
      errorCode: "PRIVATE_VIDEO",
      details: "Player config remained inaccessible",
    });
    mocks.captureVimeoConfig.mockResolvedValue({ hlsUrl: null, progressiveUrl: null });

    await expect(validateVimeoVideo("https://vimeo.com/123", page)).resolves.toEqual({
      isValid: false,
      hlsUrl: null,
      error: "Private video in browser",
      errorCode: "PRIVATE_VIDEO",
      details: "Player config remained inaccessible",
    });
  });

  it("preserves structured failures after fallbacks are exhausted", async () => {
    mocks.getVimeoVideoInfo.mockResolvedValue({
      success: false,
      error: "Video unavailable",
      errorCode: "VIDEO_NOT_FOUND",
      details: "Video ID: vimeo-id",
    });

    await expect(validateVimeoVideo("https://vimeo.com/123")).resolves.toEqual({
      isValid: false,
      hlsUrl: null,
      error: "Video unavailable",
      errorCode: "VIDEO_NOT_FOUND",
      details: "Video ID: vimeo-id",
    });
  });

  it("supplies a default error when a successful response has no video info", async () => {
    mocks.getVimeoVideoInfo.mockResolvedValue({ success: true });

    await expect(validateVimeoVideo("https://vimeo.com/123")).resolves.toEqual({
      isValid: false,
      hlsUrl: null,
      error: "Failed to fetch Vimeo video info",
    });
  });
});

describe("validateVideoHls", () => {
  it("routes Loom and Vimeo through their validators", async () => {
    mocks.getLoomVideoInfoDetailed.mockResolvedValue({
      success: true,
      info: { hlsUrl: "https://cdn.example/loom.m3u8" },
    });
    mocks.getVimeoVideoInfo.mockResolvedValue({
      success: true,
      info: { hlsUrl: "https://cdn.example/vimeo.m3u8", progressiveUrl: null },
    });

    await expect(validateVideoHls("https://loom.com/share/1", "loom", page)).resolves.toEqual({
      isValid: true,
      hlsUrl: "https://cdn.example/loom.m3u8",
    });
    await expect(
      validateVideoHls("https://vimeo.com/1", "vimeo", page, "https://course.example/lesson")
    ).resolves.toEqual({
      isValid: true,
      hlsUrl: "https://cdn.example/vimeo.m3u8",
    });
  });

  it("accepts native and external downloader video types", async () => {
    await expect(validateVideoHls("https://cdn.example/video.mp4", "native")).resolves.toEqual({
      isValid: true,
      hlsUrl: "https://cdn.example/video.mp4",
    });
    await expect(validateVideoHls("https://youtube.com/watch?v=1", "youtube")).resolves.toEqual({
      isValid: true,
      hlsUrl: null,
      details: "youtube requires yt-dlp - will attempt download",
    });
    await expect(validateVideoHls("https://wistia.com/medias/1", "wistia")).resolves.toEqual({
      isValid: true,
      hlsUrl: null,
      details: "wistia requires yt-dlp - will attempt download",
    });
  });

  it("rejects unknown video types", async () => {
    await expect(validateVideoHls("https://example.com/video", "mystery")).resolves.toEqual({
      isValid: false,
      hlsUrl: null,
      error: "Unknown video type: mystery",
      errorCode: "UNKNOWN_TYPE",
    });
  });
});
