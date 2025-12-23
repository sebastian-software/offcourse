import { describe, expect, it } from "vitest";
import { detectVideoType } from "./extractor.js";

describe("LearningSuite Extractor", () => {
  describe("detectVideoType", () => {
    it("detects Vimeo URLs", () => {
      expect(detectVideoType("https://vimeo.com/123456")).toBe("vimeo");
      expect(detectVideoType("https://player.vimeo.com/video/123456")).toBe("vimeo");
    });

    it("detects Loom URLs", () => {
      expect(detectVideoType("https://www.loom.com/share/abc123")).toBe("loom");
      expect(detectVideoType("https://loom.com/embed/abc123")).toBe("loom");
    });

    it("detects YouTube URLs", () => {
      expect(detectVideoType("https://www.youtube.com/watch?v=abc123")).toBe("youtube");
      expect(detectVideoType("https://youtu.be/abc123")).toBe("youtube");
    });

    it("detects Wistia URLs", () => {
      expect(detectVideoType("https://fast.wistia.com/medias/abc123")).toBe("wistia");
      expect(detectVideoType("https://home.wistia.net/embed/abc123")).toBe("wistia");
    });

    it("detects HLS URLs", () => {
      expect(detectVideoType("https://example.com/video.m3u8")).toBe("hls");
      expect(detectVideoType("https://cdn.example.com/stream/playlist.m3u8?token=123")).toBe("hls");
    });

    it("detects native video URLs", () => {
      expect(detectVideoType("https://example.com/video.mp4")).toBe("native");
      expect(detectVideoType("https://example.com/video.webm")).toBe("native");
    });

    it("returns unknown for unrecognized URLs", () => {
      expect(detectVideoType("https://example.com/page")).toBe("unknown");
      expect(detectVideoType("https://custom-player.com/video/123")).toBe("unknown");
    });

    it("is case insensitive", () => {
      expect(detectVideoType("https://VIMEO.COM/123")).toBe("vimeo");
      expect(detectVideoType("https://example.com/VIDEO.MP4")).toBe("native");
    });
  });
});
