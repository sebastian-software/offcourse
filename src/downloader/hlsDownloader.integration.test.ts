/**
 * Integration tests for HLS downloader.
 *
 * These tests require:
 * - ffmpeg installed and in PATH
 * - Network access (for real HLS streams)
 * - Temp directory for output files
 *
 * Run with: npm run test:integration
 *
 * Note: These tests are slow and require external dependencies.
 * They are excluded from regular `npm test` runs.
 */

import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkFfmpeg, downloadHLSVideo } from "./hlsDownloader.js";

// Test fixtures - public HLS streams for testing
const TEST_STREAMS = {
  // Apple's public test stream (always available)
  appleBasic:
    "https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8",
  // Shorter test stream
  appleShort:
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
      // This test will fail if ffmpeg is not installed
      expect(result).toBe(true);
    });
  });

  describe("downloadHLSVideo", () => {
    it("should download a short HLS stream", async () => {
      const outputPath = join(tempDir, "test-video.mp4");

      const progressUpdates: number[] = [];
      const result = await downloadHLSVideo(TEST_STREAMS.appleShort, outputPath, (progress) => {
        progressUpdates.push(progress.percent);
      });

      expect(result.success).toBe(true);
      expect(result.outputPath).toBe(outputPath);
      expect(existsSync(outputPath)).toBe(true);

      // Check file size is reasonable (at least 100KB)
      const stats = statSync(outputPath);
      expect(stats.size).toBeGreaterThan(100 * 1024);

      // Should have received progress updates
      expect(progressUpdates.length).toBeGreaterThan(0);
    }, 120000); // 2 minute timeout for download

    it("should return error for invalid URL", async () => {
      const outputPath = join(tempDir, "invalid-test.mp4");

      const result = await downloadHLSVideo(
        "https://invalid-url-that-does-not-exist.example.com/video.m3u8",
        outputPath
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should handle non-HLS URL gracefully", async () => {
      const outputPath = join(tempDir, "not-hls.mp4");

      const result = await downloadHLSVideo("https://example.com/not-a-playlist.txt", outputPath);

      expect(result.success).toBe(false);
    });
  });
});
