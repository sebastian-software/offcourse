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
 * Note: The actual download test is skipped by default in CI
 * because it can take several minutes. Run locally with:
 *   INTEGRATION_DOWNLOAD=true npm run test:integration
 */

import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkFfmpeg, downloadHLSVideo, fetchHLSQualities } from "./hlsDownloader.js";

// Test fixtures - public HLS streams for testing
const TEST_STREAMS = {
  // Apple's bipbop test stream (shorter variant)
  bipbop:
    "https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/bipbop_4x3_variant.m3u8",
};

// Skip download tests unless explicitly enabled (they're slow)
const SKIP_DOWNLOAD = !process.env.INTEGRATION_DOWNLOAD;

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

  describe("fetchHLSQualities", () => {
    it("should fetch qualities from a real HLS master playlist", async () => {
      const qualities = await fetchHLSQualities(TEST_STREAMS.bipbop);

      expect(qualities.length).toBeGreaterThan(0);
      expect(qualities[0]).toHaveProperty("url");
      expect(qualities[0]).toHaveProperty("bandwidth");
      expect(qualities[0]).toHaveProperty("label");
    }, 30000);
  });

  describe("downloadHLSVideo", () => {
    it.skipIf(SKIP_DOWNLOAD)(
      "should download a short HLS stream (slow, set INTEGRATION_DOWNLOAD=true)",
      async () => {
        const outputPath = join(tempDir, "test-video.mp4");

        const progressUpdates: number[] = [];
        const result = await downloadHLSVideo(TEST_STREAMS.bipbop, outputPath, (progress) => {
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
      },
      300000 // 5 minute timeout for actual download
    );

    it("should return error for invalid URL", async () => {
      const outputPath = join(tempDir, "invalid-test.mp4");

      const result = await downloadHLSVideo(
        "https://invalid-url-that-does-not-exist.example.com/video.m3u8",
        outputPath
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    }, 30000);

    it("should handle non-HLS URL gracefully", async () => {
      const outputPath = join(tempDir, "not-hls.mp4");

      const result = await downloadHLSVideo("https://example.com/not-a-playlist.txt", outputPath);

      expect(result.success).toBe(false);
    }, 30000);
  });
});
