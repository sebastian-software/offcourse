import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";
import {
  detectVimeoEmbed,
  detectLoomEmbed,
  detectYouTubeEmbed,
  detectWistiaEmbed,
  detectHlsVideo,
  detectNativeVideo,
  detectEmbeddedVideo,
  hasVideoEmbed,
} from "./videoDetection.js";

/**
 * Creates a mock Playwright Page with a custom evaluate implementation.
 */
function createMockPage(evaluateResult: unknown): Page {
  return {
    evaluate: vi.fn().mockResolvedValue(evaluateResult),
  } as unknown as Page;
}

describe("videoDetection", () => {
  describe("detectVimeoEmbed", () => {
    it("returns iframe src when Vimeo embed is present", async () => {
      const mockPage = createMockPage("https://player.vimeo.com/video/123456789");
      const result = await detectVimeoEmbed(mockPage);
      expect(result).toBe("https://player.vimeo.com/video/123456789");
    });

    it("returns null when no Vimeo embed is present", async () => {
      const mockPage = createMockPage(null);
      const result = await detectVimeoEmbed(mockPage);
      expect(result).toBeNull();
    });
  });

  describe("detectLoomEmbed", () => {
    it("returns iframe src when Loom embed is present", async () => {
      const mockPage = createMockPage("https://www.loom.com/embed/abc123");
      const result = await detectLoomEmbed(mockPage);
      expect(result).toBe("https://www.loom.com/embed/abc123");
    });

    it("returns null when no Loom embed is present", async () => {
      const mockPage = createMockPage(null);
      const result = await detectLoomEmbed(mockPage);
      expect(result).toBeNull();
    });
  });

  describe("detectYouTubeEmbed", () => {
    it("returns iframe src when YouTube embed is present", async () => {
      const mockPage = createMockPage("https://www.youtube.com/embed/dQw4w9WgXcQ");
      const result = await detectYouTubeEmbed(mockPage);
      expect(result).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
    });

    it("returns null when no YouTube embed is present", async () => {
      const mockPage = createMockPage(null);
      const result = await detectYouTubeEmbed(mockPage);
      expect(result).toBeNull();
    });

    it("handles youtube-nocookie.com variant", async () => {
      const mockPage = createMockPage("https://www.youtube-nocookie.com/embed/abc123");
      const result = await detectYouTubeEmbed(mockPage);
      expect(result).toBe("https://www.youtube-nocookie.com/embed/abc123");
    });
  });

  describe("detectWistiaEmbed", () => {
    it("returns id when Wistia embed is present", async () => {
      const mockPage = createMockPage({ id: "abc123xyz" });
      const result = await detectWistiaEmbed(mockPage);
      expect(result).toEqual({ id: "abc123xyz" });
    });

    it("returns null when no Wistia embed is present", async () => {
      const mockPage = createMockPage(null);
      const result = await detectWistiaEmbed(mockPage);
      expect(result).toBeNull();
    });
  });

  describe("detectHlsVideo", () => {
    it("returns m3u8 URL when HLS video is present", async () => {
      const mockPage = createMockPage("https://cdn.example.com/video/master.m3u8");
      const result = await detectHlsVideo(mockPage);
      expect(result).toBe("https://cdn.example.com/video/master.m3u8");
    });

    it("returns null when no HLS video is present", async () => {
      const mockPage = createMockPage(null);
      const result = await detectHlsVideo(mockPage);
      expect(result).toBeNull();
    });
  });

  describe("detectNativeVideo", () => {
    it("returns video src for MP4 video", async () => {
      const mockPage = createMockPage("https://example.com/video.mp4");
      const result = await detectNativeVideo(mockPage);
      expect(result).toBe("https://example.com/video.mp4");
    });

    it("returns null when no native video is present", async () => {
      const mockPage = createMockPage(null);
      const result = await detectNativeVideo(mockPage);
      expect(result).toBeNull();
    });
  });

  describe("detectEmbeddedVideo", () => {
    it("detects HLS video first (highest priority)", async () => {
      // HLS is checked first, so we mock that call to return a value
      const page = {
        evaluate: vi.fn().mockResolvedValueOnce("https://cdn.example.com/video.m3u8"),
      } as unknown as Page;

      const result = await detectEmbeddedVideo(page);
      expect(result).toEqual({ type: "hls", url: "https://cdn.example.com/video.m3u8" });
    });

    it("detects Vimeo when HLS is not present", async () => {
      const page = {
        evaluate: vi
          .fn()
          .mockResolvedValueOnce(null) // HLS
          .mockResolvedValueOnce("https://player.vimeo.com/video/123456"),
      } as unknown as Page;

      const result = await detectEmbeddedVideo(page);
      expect(result).toEqual({ type: "vimeo", url: "https://player.vimeo.com/video/123456" });
    });

    it("detects Loom when HLS and Vimeo are not present", async () => {
      const page = {
        evaluate: vi
          .fn()
          .mockResolvedValueOnce(null) // HLS
          .mockResolvedValueOnce(null) // Vimeo
          .mockResolvedValueOnce("https://www.loom.com/embed/abc123"),
      } as unknown as Page;

      const result = await detectEmbeddedVideo(page);
      expect(result).toEqual({ type: "loom", url: "https://www.loom.com/embed/abc123" });
    });

    it("detects YouTube when earlier providers are not present", async () => {
      const page = {
        evaluate: vi
          .fn()
          .mockResolvedValueOnce(null) // HLS
          .mockResolvedValueOnce(null) // Vimeo
          .mockResolvedValueOnce(null) // Loom
          .mockResolvedValueOnce("https://www.youtube.com/embed/xyz789"),
      } as unknown as Page;

      const result = await detectEmbeddedVideo(page);
      expect(result).toEqual({ type: "youtube", url: "https://www.youtube.com/embed/xyz789" });
    });

    it("detects Wistia and constructs embed URL", async () => {
      const page = {
        evaluate: vi
          .fn()
          .mockResolvedValueOnce(null) // HLS
          .mockResolvedValueOnce(null) // Vimeo
          .mockResolvedValueOnce(null) // Loom
          .mockResolvedValueOnce(null) // YouTube
          .mockResolvedValueOnce({ id: "wistia123" }),
      } as unknown as Page;

      const result = await detectEmbeddedVideo(page);
      expect(result).toEqual({
        type: "wistia",
        url: "https://fast.wistia.net/embed/iframe/wistia123",
        id: "wistia123",
      });
    });

    it("detects native video as last resort", async () => {
      const page = {
        evaluate: vi
          .fn()
          .mockResolvedValueOnce(null) // HLS
          .mockResolvedValueOnce(null) // Vimeo
          .mockResolvedValueOnce(null) // Loom
          .mockResolvedValueOnce(null) // YouTube
          .mockResolvedValueOnce(null) // Wistia
          .mockResolvedValueOnce("https://example.com/video.mp4"),
      } as unknown as Page;

      const result = await detectEmbeddedVideo(page);
      expect(result).toEqual({ type: "native", url: "https://example.com/video.mp4" });
    });

    it("returns null when no video is found", async () => {
      const page = {
        evaluate: vi.fn().mockResolvedValue(null),
      } as unknown as Page;

      const result = await detectEmbeddedVideo(page);
      expect(result).toBeNull();
    });
  });

  describe("hasVideoEmbed", () => {
    it("returns true when a video element exists", async () => {
      const mockPage = createMockPage(true);
      const result = await hasVideoEmbed(mockPage);
      expect(result).toBe(true);
    });

    it("returns false when no video elements exist", async () => {
      const mockPage = createMockPage(false);
      const result = await hasVideoEmbed(mockPage);
      expect(result).toBe(false);
    });
  });
});
