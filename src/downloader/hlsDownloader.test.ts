import { describe, expect, it } from "vitest";
import { parseHighLevelVideoUrl } from "./hlsDownloader.js";
import {
  createSegmentsUrl,
  isSegmentsUrl,
  parseHLSPlaylist,
  parseSegmentsUrl,
  SEGMENTS_URL_PREFIX,
} from "./shared/index.js";

describe("parseHLSPlaylist", () => {
  const baseUrl = "https://cdn.example.com/video/";

  it("parses master playlist with multiple qualities", () => {
    const content = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
360p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=854x480
480p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720
720p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
1080p.m3u8`;

    const result = parseHLSPlaylist(content, baseUrl);

    expect(result).toHaveLength(4);
    // Should be sorted by bandwidth (highest first)
    expect(result[0]!.label).toBe("1080p");
    expect(result[0]!.bandwidth).toBe(5000000);
    expect(result[0]!.height).toBe(1080);
    expect(result[0]!.width).toBe(1920);
    expect(result[0]!.url).toBe("https://cdn.example.com/video/1080p.m3u8");

    expect(result[3]!.label).toBe("360p");
    expect(result[3]!.bandwidth).toBe(800000);
  });

  it("handles absolute URLs in playlist", () => {
    const content = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720
https://other-cdn.com/video/720p.m3u8`;

    const result = parseHLSPlaylist(content, baseUrl);

    expect(result).toHaveLength(1);
    expect(result[0]!.url).toBe("https://other-cdn.com/video/720p.m3u8");
  });

  it("handles playlist without resolution", () => {
    const content = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=500000
audio.m3u8`;

    const result = parseHLSPlaylist(content, baseUrl);

    expect(result).toHaveLength(1);
    expect(result[0]!.label).toBe("500k");
    expect(result[0]!.height).toBeUndefined();
    expect(result[0]!.width).toBeUndefined();
  });

  it("handles empty playlist", () => {
    const content = `#EXTM3U
#EXT-X-VERSION:3`;

    const result = parseHLSPlaylist(content, baseUrl);
    expect(result).toHaveLength(0);
  });

  it("ignores comments and metadata", () => {
    const content = `#EXTM3U
#EXT-X-VERSION:3
# This is a comment
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720
720p.m3u8`;

    const result = parseHLSPlaylist(content, baseUrl);
    expect(result).toHaveLength(1);
  });

  it("handles real-world Vimeo-style playlist", () => {
    const content = `#EXTM3U
#EXT-X-VERSION:4
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=246064,BANDWIDTH=326400,CODECS="avc1.4D401E,mp4a.40.2",RESOLUTION=426x240,FRAME-RATE=24.000
https://vod.example.com/exp=123/~hmac=abc/240p/prog_index.m3u8
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=602416,BANDWIDTH=796800,CODECS="avc1.4D401F,mp4a.40.2",RESOLUTION=640x360,FRAME-RATE=24.000
https://vod.example.com/exp=123/~hmac=abc/360p/prog_index.m3u8
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=1270416,BANDWIDTH=1680000,CODECS="avc1.4D401F,mp4a.40.2",RESOLUTION=854x480,FRAME-RATE=24.000
https://vod.example.com/exp=123/~hmac=abc/480p/prog_index.m3u8`;

    const result = parseHLSPlaylist(content, baseUrl);

    expect(result).toHaveLength(3);
    expect(result[0]!.height).toBe(480);
    expect(result[1]!.height).toBe(360);
    expect(result[2]!.height).toBe(240);
  });
});

describe("parseHighLevelVideoUrl", () => {
  it("parses standard HighLevel HLS URL", () => {
    const url =
      "https://backend.leadconnectorhq.com/hls/v2/memberships/ABC123/videos/video-id-456/master.m3u8";

    const result = parseHighLevelVideoUrl(url);

    expect(result).toEqual({
      locationId: "ABC123",
      videoId: "video-id-456",
    });
  });

  it("parses URL with token", () => {
    const url =
      "https://backend.leadconnectorhq.com/hls/v2/memberships/LOC123/videos/VID456/master.m3u8?token=secret-token";

    const result = parseHighLevelVideoUrl(url);

    expect(result).toEqual({
      locationId: "LOC123",
      videoId: "VID456",
      token: "secret-token",
    });
  });

  it("handles complex video IDs", () => {
    const url =
      "https://cdn.example.com/hls/memberships/location-abc/videos/cts-184162b5f0747fcd,1080p/master.m3u8";

    const result = parseHighLevelVideoUrl(url);

    expect(result).toEqual({
      locationId: "location-abc",
      videoId: "cts-184162b5f0747fcd",
    });
  });

  it("returns null for non-HighLevel URLs", () => {
    expect(parseHighLevelVideoUrl("https://vimeo.com/123456")).toBeNull();
    expect(parseHighLevelVideoUrl("https://youtube.com/watch?v=abc")).toBeNull();
  });

  it("returns null for invalid URLs", () => {
    expect(parseHighLevelVideoUrl("not-a-url")).toBeNull();
    expect(parseHighLevelVideoUrl("")).toBeNull();
  });

  it("returns null for missing video path", () => {
    const url = "https://backend.leadconnectorhq.com/hls/v2/other/path";
    expect(parseHighLevelVideoUrl(url)).toBeNull();
  });
});

describe("Segment URL Helpers", () => {
  const sampleSegments = [
    "https://cdn.example.com/video0.ts?token=abc123",
    "https://cdn.example.com/video1.ts?token=def456",
    "https://cdn.example.com/video2.ts?token=ghi789",
  ];

  describe("SEGMENTS_URL_PREFIX", () => {
    it("has the correct prefix value", () => {
      expect(SEGMENTS_URL_PREFIX).toBe("segments:");
    });
  });

  describe("isSegmentsUrl", () => {
    it("returns true for valid segments URL", () => {
      const segmentsUrl = createSegmentsUrl(sampleSegments);
      expect(isSegmentsUrl(segmentsUrl)).toBe(true);
    });

    it("returns true for any string starting with prefix", () => {
      expect(isSegmentsUrl("segments:anything")).toBe(true);
      expect(isSegmentsUrl("segments:")).toBe(true);
    });

    it("returns false for regular URLs", () => {
      expect(isSegmentsUrl("https://example.com/video.m3u8")).toBe(false);
      expect(isSegmentsUrl("http://cdn.example.com/master.m3u8")).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(isSegmentsUrl("")).toBe(false);
    });

    it("returns false for similar but incorrect prefixes", () => {
      expect(isSegmentsUrl("segment:abc")).toBe(false);
      expect(isSegmentsUrl("Segments:abc")).toBe(false);
    });
  });

  describe("createSegmentsUrl", () => {
    it("creates a URL with correct prefix", () => {
      const url = createSegmentsUrl(sampleSegments);
      expect(url.startsWith(SEGMENTS_URL_PREFIX)).toBe(true);
    });

    it("creates base64-encoded content", () => {
      const url = createSegmentsUrl(sampleSegments);
      const base64Part = url.slice(SEGMENTS_URL_PREFIX.length);

      // Should be valid base64
      const decoded = Buffer.from(base64Part, "base64").toString("utf-8");
      const parsed = JSON.parse(decoded);

      expect(parsed).toEqual(sampleSegments);
    });

    it("handles empty array", () => {
      const url = createSegmentsUrl([]);
      expect(isSegmentsUrl(url)).toBe(true);

      const parsed = parseSegmentsUrl(url);
      expect(parsed).toEqual([]);
    });

    it("handles single segment", () => {
      const url = createSegmentsUrl(["https://example.com/video0.ts"]);
      const parsed = parseSegmentsUrl(url);
      expect(parsed).toEqual(["https://example.com/video0.ts"]);
    });

    it("handles URLs with special characters", () => {
      const specialSegments = [
        "https://cdn.example.com/video0.ts?token=abc&hmac=xyz%3D%3D",
        "https://cdn.example.com/video1.ts?token=abc+def",
      ];

      const url = createSegmentsUrl(specialSegments);
      const parsed = parseSegmentsUrl(url);
      expect(parsed).toEqual(specialSegments);
    });
  });

  describe("parseSegmentsUrl", () => {
    it("parses valid segments URL correctly", () => {
      const url = createSegmentsUrl(sampleSegments);
      const result = parseSegmentsUrl(url);

      expect(result).toEqual(sampleSegments);
    });

    it("returns null for non-segments URL", () => {
      expect(parseSegmentsUrl("https://example.com/video.m3u8")).toBeNull();
    });

    it("returns null for invalid base64", () => {
      expect(parseSegmentsUrl("segments:not-valid-base64!@#$")).toBeNull();
    });

    it("returns null for valid base64 but invalid JSON", () => {
      const invalidJson = Buffer.from("not json at all").toString("base64");
      expect(parseSegmentsUrl(`segments:${invalidJson}`)).toBeNull();
    });

    it("returns null for JSON that is not an array", () => {
      const objectJson = Buffer.from(JSON.stringify({ url: "test" })).toString("base64");
      expect(parseSegmentsUrl(`segments:${objectJson}`)).toBeNull();

      const stringJson = Buffer.from(JSON.stringify("just a string")).toString("base64");
      expect(parseSegmentsUrl(`segments:${stringJson}`)).toBeNull();

      const numberJson = Buffer.from(JSON.stringify(12345)).toString("base64");
      expect(parseSegmentsUrl(`segments:${numberJson}`)).toBeNull();
    });

    it("returns null for array with non-string items", () => {
      const mixedArray = Buffer.from(JSON.stringify(["url1", 123, "url2"])).toString("base64");
      expect(parseSegmentsUrl(`segments:${mixedArray}`)).toBeNull();

      const objectArray = Buffer.from(JSON.stringify([{ url: "test" }])).toString("base64");
      expect(parseSegmentsUrl(`segments:${objectArray}`)).toBeNull();
    });

    it("handles empty segments prefix", () => {
      // Just the prefix with no content
      expect(parseSegmentsUrl("segments:")).toBeNull();
    });

    it("roundtrips correctly", () => {
      const original = [
        "https://cdn.b-cdn.net/video0.ts?token=abc",
        "https://cdn.b-cdn.net/video1.ts?token=def",
        "https://cdn.b-cdn.net/video2.ts?token=ghi",
        "https://cdn.b-cdn.net/video3.ts?token=jkl",
      ];

      const url = createSegmentsUrl(original);
      const parsed = parseSegmentsUrl(url);

      expect(parsed).toEqual(original);
    });

    it("preserves segment order", () => {
      const orderedSegments = Array.from(
        { length: 100 },
        (_, i) => `https://cdn.example.com/video${i}.ts?token=${i}`
      );

      const url = createSegmentsUrl(orderedSegments);
      const parsed = parseSegmentsUrl(url);

      expect(parsed).toEqual(orderedSegments);
    });
  });
});
