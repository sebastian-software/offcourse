import { describe, expect, it } from "vitest";
import {
  detectVideoType,
  getCompleteLearningSuiteSegments,
  getLearningSuiteSegmentIndex,
  parseLearningSuiteBunnyPayload,
} from "./extractor.js";

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

  describe("LearningSuite HLS segments", () => {
    const segment = (index: number, token = "token", rendition = "720p") =>
      `https://vz-example.b-cdn.net/${rendition}/video${index}.ts?token=${token}`;

    it("extracts Bunny segment indexes", () => {
      expect(getLearningSuiteSegmentIndex(segment(42))).toBe(42);
      expect(getLearningSuiteSegmentIndex("https://example.com/playlist.m3u8")).toBeNull();
    });

    it("returns a complete ordered sequence and keeps the freshest token", () => {
      expect(
        getCompleteLearningSuiteSegments(
          [segment(2), segment(0, "old"), segment(1), segment(0, "new")],
          12
        )
      ).toEqual([segment(0, "new"), segment(1), segment(2)]);
    });

    it("rejects sequences with gaps or implausibly little coverage", () => {
      expect(getCompleteLearningSuiteSegments([segment(0), segment(2)], 12)).toBeNull();
      expect(getCompleteLearningSuiteSegments([segment(0)], 196)).toBeNull();
    });

    it("selects the most complete rendition without mixing equal segment indexes", () => {
      const low = (index: number, token = "low") => segment(index, token, "480p");
      const high = (index: number, token = "high") => segment(index, token, "1080p");

      expect(
        getCompleteLearningSuiteSegments(
          [low(0), low(1), high(0), high(1), high(2, "old"), high(2, "fresh")],
          12
        )
      ).toEqual([high(0), high(1), high(2, "fresh")]);
    });

    it("prefers the highest quality when complete renditions have equal size", () => {
      const low = (index: number) => segment(index, "low", "480p");
      const high = (index: number) => segment(index, "high", "1920x1080");

      expect(getCompleteLearningSuiteSegments([low(0), high(0), low(1), high(1)], 8)).toEqual([
        high(0),
        high(1),
      ]);
    });

    it("rejects adaptive switches when no rendition covers the full observed range", () => {
      expect(
        getCompleteLearningSuiteSegments(
          [segment(0, "low", "480p"), segment(1, "low", "480p"), segment(2, "high", "1080p")],
          12
        )
      ).toBeNull();
    });

    it("groups relative segment paths by rendition", () => {
      const relative = (index: number) => `/play_720p/video${index}.ts?token=relative`;

      expect(getCompleteLearningSuiteSegments([relative(1), relative(0)], 8)).toEqual([
        relative(0),
        relative(1),
      ]);
    });
  });

  describe("Bunny response parsing", () => {
    it("extracts and deduplicates absolute playlist segments", () => {
      expect(
        parseLearningSuiteBunnyPayload(`#EXTM3U
#EXTINF:4,
https://vz-example.b-cdn.net/video-id/720p/video0.ts?token=zero
#EXTINF:4,
https://vz-example.b-cdn.net/video-id/720p/video1.ts?token=one
https://vz-example.b-cdn.net/video-id/720p/video1.ts?token=one`)
      ).toEqual({
        segmentUrls: [
          "https://vz-example.b-cdn.net/video-id/720p/video0.ts?token=zero",
          "https://vz-example.b-cdn.net/video-id/720p/video1.ts?token=one",
        ],
        hlsUrls: ["https://vz-example.b-cdn.net/video-id/720p/playlist.m3u8"],
      });
    });

    it("resolves tokenized relative segments against a nested CDN directory", () => {
      expect(
        parseLearningSuiteBunnyPayload(`#EXTM3U
https://vz-example.b-cdn.net/video-id/1080p/playlist.m3u8?token=playlist
video0.ts?token=zero&amp;expires=1
video1.ts
#EXT-X-ENDLIST`)
      ).toEqual({
        segmentUrls: ["https://vz-example.b-cdn.net/video-id/1080p/video0.ts?token=zero&expires=1"],
        hlsUrls: [
          "https://vz-example.b-cdn.net/video-id/1080p/playlist.m3u8",
          "https://vz-example.b-cdn.net/video-id/1080p/playlist.m3u8?token=playlist",
        ],
      });
    });

    it("normalizes escaped JSON URLs and ignores non-video CDN assets", () => {
      expect(
        parseLearningSuiteBunnyPayload(
          String.raw`{"playlist":"https:\/\/vz-example.b-cdn.net\/video-id\/playlist.m3u8?token=abc&amp;expires=1","segment":"https:\/\/vz-example.b-cdn.net\/video-id\/video0.ts?token=def","thumbnail":"https:\/\/vz-example.b-cdn.net\/video-id\/thumbnail.jpg"}`
        )
      ).toEqual({
        segmentUrls: ["https://vz-example.b-cdn.net/video-id/video0.ts?token=def"],
        hlsUrls: ["https://vz-example.b-cdn.net/video-id/playlist.m3u8?token=abc&expires=1"],
      });
    });

    it("returns empty results for unrelated response bodies", () => {
      expect(parseLearningSuiteBunnyPayload('{"status":"ok"}')).toEqual({
        segmentUrls: [],
        hlsUrls: [],
      });
    });
  });
});
