import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface SegmentDownloadResult {
  success: boolean;
  error?: string;
}

const sharedMocks = vi.hoisted(() => ({
  checkFfmpeg: vi.fn<() => Promise<boolean>>(),
  downloadSegmentsToFile:
    vi.fn<
      (
        segments: string[],
        outputPath: string,
        options?: { onProgress?: (current: number, total: number) => void }
      ) => Promise<SegmentDownloadResult>
    >(),
  getSegmentUrls: vi.fn<(playlistUrl: string) => Promise<string[]>>(),
  mergeVideoAudio:
    vi.fn<(videoPath: string, audioPath: string, outputPath: string) => Promise<boolean>>(),
  parseHlsMasterPlaylist:
    vi.fn<(playlistUrl: string) => Promise<{ videoUrl: string | null; audioUrl: string | null }>>(),
}));

vi.mock("./shared/index.js", () => sharedMocks);

import { downloadLoomVideo, extractLoomId } from "./loomDownloader.js";

describe("extractLoomId", () => {
  it("extracts ID from embed URL", () => {
    const url = "https://www.loom.com/embed/a1b2c3d4e5f6";
    expect(extractLoomId(url)).toBe("a1b2c3d4e5f6");
  });

  it("extracts ID from share URL", () => {
    const url = "https://www.loom.com/share/abcdef123456";
    expect(extractLoomId(url)).toBe("abcdef123456");
  });

  it("extracts ID from URL with query params", () => {
    const url = "https://www.loom.com/embed/abc123?autoplay=1&t=10";
    expect(extractLoomId(url)).toBe("abc123");
  });

  it("handles URL without www", () => {
    const url = "https://loom.com/embed/abc123def456";
    expect(extractLoomId(url)).toBe("abc123def456");
  });

  it("returns null for invalid URL", () => {
    expect(extractLoomId("https://youtube.com/watch?v=123")).toBeNull();
    expect(extractLoomId("not-a-url")).toBeNull();
  });

  it("returns null for Loom homepage", () => {
    expect(extractLoomId("https://loom.com")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractLoomId("")).toBeNull();
  });

  it("handles very long IDs", () => {
    const longId = "a".repeat(32);
    const url = `https://loom.com/embed/${longId}`;
    expect(extractLoomId(url)).toBe(longId);
  });
});

describe("downloadLoomVideo", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "offcourse-loom-"));
    vi.clearAllMocks();
    sharedMocks.checkFfmpeg.mockResolvedValue(true);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("falls back to a video-only download when the audio playlist is empty", async () => {
    sharedMocks.getSegmentUrls
      .mockResolvedValueOnce(["https://cdn.example/video-1.ts"])
      .mockResolvedValueOnce([]);
    sharedMocks.downloadSegmentsToFile.mockResolvedValue({ success: true });

    const outputPath = join(testDir, "video.ts");
    const result = await downloadLoomVideo(
      "https://luna.loom.com/example/mediaplaylist-video-bitrate1000.m3u8",
      outputPath
    );

    expect(result).toEqual({ success: true });
    expect(sharedMocks.downloadSegmentsToFile).toHaveBeenCalledOnce();
    expect(sharedMocks.downloadSegmentsToFile).toHaveBeenCalledWith(
      ["https://cdn.example/video-1.ts"],
      outputPath,
      expect.any(Object)
    );
    expect(sharedMocks.mergeVideoAudio).not.toHaveBeenCalled();
  });

  it("removes the downloaded video temp file when the audio download fails", async () => {
    sharedMocks.getSegmentUrls
      .mockResolvedValueOnce(["https://cdn.example/video-1.ts"])
      .mockResolvedValueOnce(["https://cdn.example/audio-1.ts"]);
    sharedMocks.downloadSegmentsToFile
      .mockImplementationOnce(async (_segments, path) => {
        writeFileSync(path, "video");
        return { success: true };
      })
      .mockResolvedValueOnce({ success: false, error: "audio segment failed" });

    const result = await downloadLoomVideo(
      "https://luna.loom.com/example/mediaplaylist-video-bitrate1000.m3u8",
      join(testDir, "video.ts")
    );

    expect(result).toMatchObject({
      success: false,
      errorCode: "DOWNLOAD_FAILED",
      details: "audio segment failed; Audio had 1 segments",
    });
    const tempVideoPath = sharedMocks.downloadSegmentsToFile.mock.calls[0]?.[1];
    expect(tempVideoPath).toBeTypeOf("string");
    if (!tempVideoPath) throw new Error("Expected a video temp path");
    expect(existsSync(tempVideoPath)).toBe(false);
  });

  it("removes a partial video temp file when the video download fails", async () => {
    sharedMocks.getSegmentUrls
      .mockResolvedValueOnce(["https://cdn.example/video-1.ts"])
      .mockResolvedValueOnce(["https://cdn.example/audio-1.ts"]);
    sharedMocks.downloadSegmentsToFile.mockImplementationOnce(async (_segments, path) => {
      writeFileSync(path, "partial video");
      return { success: false, error: "video segment failed" };
    });

    const result = await downloadLoomVideo(
      "https://luna.loom.com/example/mediaplaylist-video-bitrate1000.m3u8",
      join(testDir, "video.ts")
    );

    expect(result).toMatchObject({
      success: false,
      errorCode: "DOWNLOAD_FAILED",
      details: "video segment failed; Video had 1 segments",
    });
    const tempVideoPath = sharedMocks.downloadSegmentsToFile.mock.calls[0]?.[1];
    if (!tempVideoPath) throw new Error("Expected a video temp path");
    expect(existsSync(tempVideoPath)).toBe(false);
    expect(sharedMocks.downloadSegmentsToFile).toHaveBeenCalledOnce();
  });

  it("returns a structured error and removes both temp files when merging throws", async () => {
    sharedMocks.getSegmentUrls
      .mockResolvedValueOnce(["https://cdn.example/video-1.ts"])
      .mockResolvedValueOnce(["https://cdn.example/audio-1.ts"]);
    sharedMocks.downloadSegmentsToFile.mockImplementation(async (_segments, path) => {
      writeFileSync(path, "segment data");
      return { success: true };
    });
    sharedMocks.mergeVideoAudio.mockRejectedValue(new Error("ffmpeg crashed"));

    const result = await downloadLoomVideo(
      "https://luna.loom.com/example/mediaplaylist-video-bitrate1000.m3u8",
      join(testDir, "video.ts")
    );

    expect(result).toEqual({
      success: false,
      error: "Failed to merge video and audio with ffmpeg",
      errorCode: "MERGE_FAILED",
      details: "ffmpeg crashed",
    });

    for (const call of sharedMocks.downloadSegmentsToFile.mock.calls) {
      expect(existsSync(call[1])).toBe(false);
    }
  });
});
