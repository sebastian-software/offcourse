/**
 * Integration tests for HLS downloader.
 *
 * These tests require:
 * - ffmpeg installed and in PATH
 * - Network access (for HLS streams)
 * - Temp directory for output files
 *
 * Run with: npm run test:integration
 */

import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { downloadHLSVideo, fetchHLSQualities } from "./hlsDownloader.js";
import { checkFfmpeg } from "./shared/index.js";

// Test fixtures - HLS streams for testing
const TEST_STREAMS = {
  // Our own tiny test stream hosted on GitHub Pages (~40KB, 4 seconds)
  local: "https://sebastian-software.github.io/offcourse/test-stream/playlist.m3u8",
  // Apple's bipbop master playlist (for quality detection, has multiple qualities)
  bipbopMaster:
    "https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/bipbop_4x3_variant.m3u8",
};

describe("HLS Downloader Integration", () => {
  let tempDir: string;

  beforeAll(() => {
    // Create temp directory for test outputs
    tempDir = join(tmpdir(), `offcourse-hls-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterAll(() => {
    // Clean up temp directory
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("checkFfmpeg", () => {
    it("should detect ffmpeg when installed", async () => {
      const result = await checkFfmpeg();
      expect(result).toBe(true);
    });
  });

  describe("fetchHLSQualities", () => {
    it("should fetch qualities from a real HLS master playlist", async () => {
      const qualities = await fetchHLSQualities(TEST_STREAMS.bipbopMaster);

      expect(qualities.length).toBeGreaterThan(0);
      expect(qualities[0]).toHaveProperty("url");
      expect(qualities[0]).toHaveProperty("bandwidth");
      expect(qualities[0]).toHaveProperty("label");

      // Bipbop should have multiple quality levels
      expect(qualities.length).toBeGreaterThanOrEqual(4);
    }, 15000);
  });

  describe("downloadHLSVideo", () => {
    it("should return error for invalid URL", async () => {
      const outputPath = join(tempDir, "invalid-test.mp4");

      const result = await downloadHLSVideo(
        "https://invalid-url-that-does-not-exist.example.com/video.m3u8",
        outputPath
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    }, 15000);

    it("should handle non-HLS URL gracefully", async () => {
      const outputPath = join(tempDir, "not-hls.mp4");

      const result = await downloadHLSVideo("https://example.com/not-a-playlist.txt", outputPath);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBeDefined();
    }, 15000);

    // Download test using our tiny hosted test stream (~40KB, 4 seconds)
    it("should download our test HLS stream", async () => {
      const outputPath = join(tempDir, "test-video.mp4");

      const progressUpdates: number[] = [];
      const result = await downloadHLSVideo(TEST_STREAMS.local, outputPath, (progress) => {
        progressUpdates.push(progress.percent);
      });

      expect(result.success).toBe(true);
      expect(result.outputPath).toBe(outputPath);
      expect(existsSync(outputPath)).toBe(true);

      // Check file size is reasonable (our test stream is ~40KB)
      const stats = statSync(outputPath);
      expect(stats.size).toBeGreaterThan(10 * 1024);

      // Should have received progress updates
      expect(progressUpdates.length).toBeGreaterThan(0);
    }, 30000); // 30 second timeout should be plenty for ~40KB
  });
});
