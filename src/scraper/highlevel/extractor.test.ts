import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseHLSMasterPlaylist } from "./extractor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "../../__fixtures__");

describe("parseHLSMasterPlaylist", () => {
  const baseUrl = "https://cdn.example.com/video/";

  it("parses master playlist with multiple qualities", () => {
    const content = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
360p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720
720p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
1080p.m3u8`;

    const result = parseHLSMasterPlaylist(content, baseUrl);

    expect(result).toHaveLength(3);
    // Should be sorted by bandwidth (highest first)
    expect(result[0]!.label).toBe("1080p");
    expect(result[0]!.bandwidth).toBe(5000000);
    expect(result[0]!.height).toBe(1080);
    expect(result[0]!.width).toBe(1920);
  });

  it("resolves relative URLs correctly", () => {
    const content = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720
720p/index.m3u8`;

    const result = parseHLSMasterPlaylist(content, baseUrl);

    expect(result[0]!.url).toBe("https://cdn.example.com/video/720p/index.m3u8");
  });

  it("preserves absolute URLs", () => {
    const content = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720
https://other-cdn.com/720p.m3u8`;

    const result = parseHLSMasterPlaylist(content, baseUrl);

    expect(result[0]!.url).toBe("https://other-cdn.com/720p.m3u8");
  });

  it("handles playlist without resolution (audio only)", () => {
    const content = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=128000
audio.m3u8`;

    const result = parseHLSMasterPlaylist(content, baseUrl);

    expect(result).toHaveLength(1);
    expect(result[0]!.label).toBe("128k");
    expect(result[0]!.height).toBeUndefined();
  });

  it("returns empty array for empty playlist", () => {
    const content = `#EXTM3U
#EXT-X-VERSION:3`;

    const result = parseHLSMasterPlaylist(content, baseUrl);
    expect(result).toHaveLength(0);
  });

  describe("with fixture file", () => {
    it("parses real-world HLS master playlist", () => {
      const content = readFileSync(join(fixturesDir, "hls-master-playlist.m3u8"), "utf-8");

      const result = parseHLSMasterPlaylist(content, "https://cdn.example.com/video/");

      expect(result).toHaveLength(5);

      // Sorted by bandwidth (highest first)
      expect(result[0]!.label).toBe("1080p");
      expect(result[0]!.height).toBe(1080);
      expect(result[0]!.bandwidth).toBe(6000000);

      expect(result[4]!.label).toBe("240p");
      expect(result[4]!.height).toBe(240);
    });

    it("snapshot: parsed playlist structure", () => {
      const content = readFileSync(join(fixturesDir, "hls-master-playlist.m3u8"), "utf-8");
      const result = parseHLSMasterPlaylist(content, "https://cdn.example.com/video/");

      expect(result).toMatchSnapshot();
    });
  });
});

describe("HighLevel API Response parsing", () => {
  it("snapshot: fixture structure", () => {
    const response = JSON.parse(
      readFileSync(join(fixturesDir, "highlevel-post-response.json"), "utf-8")
    );

    // Verify the structure we depend on
    expect(response).toHaveProperty("id");
    expect(response).toHaveProperty("title");
    expect(response).toHaveProperty("video");
    expect(response).toHaveProperty("post_materials");

    // Video structure
    expect(response.video).toHaveProperty("url");
    expect(response.video).toHaveProperty("assetsLicenseId");
    expect(response.video.url).toMatch(/\.mp4$/);

    // Materials structure
    expect(response.post_materials).toHaveLength(2);
    expect(response.post_materials[0]).toHaveProperty("name");
    expect(response.post_materials[0]).toHaveProperty("url");
  });

  it("extracts video info from response", () => {
    const response = JSON.parse(
      readFileSync(join(fixturesDir, "highlevel-post-response.json"), "utf-8")
    );

    // Simulate the extraction logic
    const video = response.video;
    const assetId = video?.assetsLicenseId ?? video?.assetId ?? video?.id;
    const directUrl = video?.url;

    expect(assetId).toBe("689a0d672ea246086539f453");
    expect(directUrl).toContain("1080p.mp4");
  });
});
