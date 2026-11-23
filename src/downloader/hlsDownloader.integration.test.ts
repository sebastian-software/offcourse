/**
 * Integration tests for HLS downloader.
 *
 * These tests require:
 * - ffmpeg installed and in PATH
 * - Network access (for the public master playlist check)
 * - Temp directory for output files
 *
 * Run with: pnpm test:integration
 */

import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { downloadHLSVideo, fetchHLSQualities } from "./hlsDownloader.js";
import { checkFfmpeg } from "./shared/index.js";

// Test fixtures - HLS streams for testing
const TEST_STREAMS = {
  // Apple's bipbop master playlist (for quality detection, has multiple qualities)
  bipbopMaster:
    "https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/bipbop_4x3_variant.m3u8",
};

describe("HLS Downloader Integration", () => {
  let tempDir: string;
  let server: Server;
  let streamUrl: string;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "offcourse-hls-test-"));
    const fixtures = fileURLToPath(new URL("../../docs/test-stream/", import.meta.url));
    server = createServer((request, response) => {
      const path = request.url ?? "";
      if (!/^\/(playlist\.m3u8|seg[0-3]\.ts)$/.test(path)) {
        response.writeHead(404).end();
        return;
      }

      response.setHeader(
        "Content-Type",
        path.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t"
      );
      createReadStream(join(fixtures, path.slice(1)))
        .on("error", (error) => response.destroy(error))
        .pipe(response);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("HLS fixture did not bind to a TCP port");
    }
    streamUrl = `http://127.0.0.1:${address.port}/playlist.m3u8`;
  });

  afterAll(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
    if (tempDir) {
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

    it("should download our test HLS stream", async () => {
      const outputPath = join(tempDir, "test-video.mp4");

      const progressUpdates: number[] = [];
      const result = await downloadHLSVideo(streamUrl, outputPath, (progress) => {
        progressUpdates.push(progress.percent);
      });

      expect(result.success, result.error).toBe(true);
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
