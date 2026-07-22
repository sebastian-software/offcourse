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
  downloadProgressiveVideo:
    vi.fn<
      (
        url: string,
        outputPath: string,
        options?: { onProgress?: unknown; referer?: string }
      ) => Promise<{ success: boolean }>
    >(),
  downloadSegmentsToFile: vi.fn<
    (
      segments: string[],
      outputPath: string,
      options?: {
        headers?: Record<string, string>;
        onProgress?: (current: number, total: number) => void;
      }
    ) => Promise<SegmentDownloadResult>
  >(),
  getSegmentUrls:
    vi.fn<(playlistUrl: string, headers?: Record<string, string>) => Promise<string[]>>(),
  mergeVideoAudio:
    vi.fn<(videoPath: string, audioPath: string, outputPath: string) => Promise<boolean>>(),
  parseHlsMasterPlaylist:
    vi.fn<
      (
        playlistUrl: string,
        headers?: Record<string, string>
      ) => Promise<{ videoUrl: string | null; audioUrl: string | null }>
    >(),
  selectVimeoHlsUrl: vi.fn(
    (
      hls:
        | { default_cdn?: string; cdns?: Record<string, { avc_url?: string; url?: string }> }
        | null
        | undefined
    ) => {
      const cdns = hls?.cdns ?? {};
      for (const key of [
        hls?.default_cdn,
        "akfire_interconnect_quic",
        "akamai_live",
        "fastly_skyfire",
        "fastly",
      ]) {
        const cdn = key ? cdns[key] : undefined;
        const url = cdn?.avc_url ?? cdn?.url;
        if (url) return url;
      }
      return (
        Object.values(cdns)
          .map((cdn) => cdn.avc_url ?? cdn.url)
          .find(Boolean) ?? null
      );
    }
  ),
  selectVimeoProgressiveUrl: vi.fn(
    (progressive: { height?: number; url?: string }[] | null | undefined) =>
      [...(progressive ?? [])]
        .filter((rendition) => Boolean(rendition.url))
        .sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0]?.url ?? null
  ),
}));

vi.mock("./shared/index.js", () => sharedMocks);

import { downloadVimeoVideo, extractVimeoId, parseVimeoConfig } from "./vimeoDownloader.js";

describe("parseVimeoConfig", () => {
  it("prefers the configured Vimeo CDN and highest progressive rendition", () => {
    const result = parseVimeoConfig(
      {
        video: { title: "Course video", duration: 42, width: 1280, height: 720 },
        request: {
          files: {
            hls: {
              cdns: {
                fallback: { url: "https://fallback.test/master.m3u8" },
                fastly_skyfire: { url: "https://preferred.test/master.m3u8" },
              },
            },
            progressive: [
              { height: 360, url: "https://cdn.test/360.mp4" },
              { height: 1080, url: "https://cdn.test/1080.mp4" },
            ],
          },
        },
      },
      "123"
    );

    expect(result).toMatchObject({
      success: true,
      info: {
        id: "123",
        title: "Course video",
        hlsUrl: "https://preferred.test/master.m3u8",
        progressiveUrl: "https://cdn.test/1080.mp4",
      },
    });
  });

  it("falls back to the first available HLS CDN", () => {
    expect(
      parseVimeoConfig(
        { request: { files: { hls: { cdns: { custom: { url: "https://custom.test/hls" } } } } } },
        "123"
      )
    ).toMatchObject({ success: true, info: { hlsUrl: "https://custom.test/hls" } });
  });

  it("reports DASH-only configs as DRM protected", () => {
    expect(
      parseVimeoConfig(
        { video: { title: "Protected" }, request: { files: { dash: { cdns: {} } } } },
        "123"
      )
    ).toMatchObject({ success: false, errorCode: "DRM_PROTECTED" });
  });

  it("reports configs without downloadable streams", () => {
    expect(parseVimeoConfig({}, "123")).toMatchObject({
      success: false,
      errorCode: "PARSE_ERROR",
    });
  });
});

describe("downloadVimeoVideo HLS", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "offcourse-vimeo-"));
    vi.clearAllMocks();
    sharedMocks.checkFfmpeg.mockResolvedValue(true);
    sharedMocks.parseHlsMasterPlaylist.mockResolvedValue({
      videoUrl: "https://skyfire.vimeocdn.com/video.m3u8?token=abc",
      audioUrl: "https://skyfire.vimeocdn.com/audio.m3u8?token=abc",
    });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("downloads and merges separate Vimeo video and audio renditions", async () => {
    sharedMocks.getSegmentUrls
      .mockResolvedValueOnce(["https://cdn.test/video-1.ts?token=abc"])
      .mockResolvedValueOnce(["https://cdn.test/audio-1.ts?token=abc"]);
    sharedMocks.downloadSegmentsToFile.mockImplementation(async (_segments, path) => {
      writeFileSync(path, "segment data");
      return { success: true };
    });
    sharedMocks.mergeVideoAudio.mockImplementation(async (videoPath, audioPath) => {
      expect(existsSync(videoPath)).toBe(true);
      expect(existsSync(audioPath)).toBe(true);
      return true;
    });

    const result = await downloadVimeoVideo(
      "https://skyfire.vimeocdn.com/master.m3u8?token=abc",
      join(testDir, "video.mp4")
    );

    expect(result).toEqual({ success: true });
    expect(sharedMocks.downloadSegmentsToFile).toHaveBeenCalledTimes(2);
    expect(sharedMocks.mergeVideoAudio).toHaveBeenCalledOnce();
    for (const call of sharedMocks.downloadSegmentsToFile.mock.calls) {
      expect(existsSync(call[1])).toBe(false);
      expect(call[2]?.headers).toEqual({ Referer: "https://player.vimeo.com/" });
    }
  });

  it("fails explicitly instead of producing a silent video without ffmpeg", async () => {
    sharedMocks.getSegmentUrls
      .mockResolvedValueOnce(["https://cdn.test/video-1.ts"])
      .mockResolvedValueOnce(["https://cdn.test/audio-1.ts"]);
    sharedMocks.checkFfmpeg.mockResolvedValue(false);

    const result = await downloadVimeoVideo(
      "https://skyfire.vimeocdn.com/master.m3u8?token=abc",
      join(testDir, "video.mp4")
    );

    expect(result).toMatchObject({ success: false, errorCode: "FFMPEG_NOT_FOUND" });
    expect(sharedMocks.downloadSegmentsToFile).not.toHaveBeenCalled();
  });

  it("returns a structured merge error and cleans temp files when ffmpeg throws", async () => {
    sharedMocks.getSegmentUrls
      .mockResolvedValueOnce(["https://cdn.test/video-1.ts"])
      .mockResolvedValueOnce(["https://cdn.test/audio-1.ts"]);
    sharedMocks.downloadSegmentsToFile.mockImplementation(async (_segments, path) => {
      writeFileSync(path, "segment data");
      return { success: true };
    });
    sharedMocks.mergeVideoAudio.mockRejectedValue(new Error("ffmpeg crashed"));

    const result = await downloadVimeoVideo(
      "https://skyfire.vimeocdn.com/master.m3u8?token=abc",
      join(testDir, "video.mp4")
    );

    expect(result).toMatchObject({
      success: false,
      errorCode: "MERGE_FAILED",
      details: "ffmpeg crashed",
    });
    for (const call of sharedMocks.downloadSegmentsToFile.mock.calls) {
      expect(existsSync(call[1])).toBe(false);
    }
  });

  it("cleans a partial temp file when the video segment download fails", async () => {
    sharedMocks.getSegmentUrls
      .mockResolvedValueOnce(["https://cdn.test/video-1.ts"])
      .mockResolvedValueOnce(["https://cdn.test/audio-1.ts"]);
    sharedMocks.downloadSegmentsToFile.mockImplementationOnce(async (_segments, path) => {
      writeFileSync(path, "partial video");
      return { success: false, error: "video segment failed" };
    });

    const result = await downloadVimeoVideo(
      "https://skyfire.vimeocdn.com/master.m3u8?token=abc",
      join(testDir, "video.mp4")
    );

    expect(result).toMatchObject({
      success: false,
      errorCode: "DOWNLOAD_FAILED",
      details: "video segment failed",
    });
    const tempVideoPath = sharedMocks.downloadSegmentsToFile.mock.calls[0]?.[1];
    if (!tempVideoPath) throw new Error("Expected a video temp path");
    expect(existsSync(tempVideoPath)).toBe(false);
  });
});

describe("extractVimeoId", () => {
  it("extracts ID from standard vimeo.com URL", () => {
    const url = "https://vimeo.com/123456789";
    expect(extractVimeoId(url)).toBe("123456789");
  });

  it("extracts ID from vimeo.com/video URL", () => {
    const url = "https://vimeo.com/video/123456789";
    expect(extractVimeoId(url)).toBe("123456789");
  });

  it("extracts ID from player.vimeo.com URL", () => {
    const url = "https://player.vimeo.com/video/987654321";
    expect(extractVimeoId(url)).toBe("987654321");
  });

  it("extracts ID from channel URL", () => {
    const url = "https://vimeo.com/channels/staffpicks/123456789";
    expect(extractVimeoId(url)).toBe("123456789");
  });

  it("extracts ID from groups URL", () => {
    const url = "https://vimeo.com/groups/shortfilms/videos/123456789";
    expect(extractVimeoId(url)).toBe("123456789");
  });

  it("extracts ID from URL with query params", () => {
    const url = "https://vimeo.com/123456789?share=copy&autoplay=1";
    expect(extractVimeoId(url)).toBe("123456789");
  });

  it("extracts ID from URL with hash for unlisted videos", () => {
    const url = "https://vimeo.com/123456789/abcdef1234";
    expect(extractVimeoId(url)).toBe("123456789");
  });

  it("extracts ID from player URL with h parameter", () => {
    const url = "https://player.vimeo.com/video/123456789?h=abcdef1234";
    expect(extractVimeoId(url)).toBe("123456789");
  });

  it("returns null for non-Vimeo URL", () => {
    expect(extractVimeoId("https://youtube.com/watch?v=abc123")).toBeNull();
    expect(extractVimeoId("https://loom.com/embed/abc123")).toBeNull();
  });

  it("returns null for Vimeo homepage", () => {
    expect(extractVimeoId("https://vimeo.com")).toBeNull();
    expect(extractVimeoId("https://vimeo.com/")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractVimeoId("")).toBeNull();
  });

  it("returns null for invalid string", () => {
    expect(extractVimeoId("not-a-url")).toBeNull();
  });
});
