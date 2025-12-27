/**
 * Loom video downloader.
 * Downloads videos from Loom using HLS streaming.
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import delay from "delay";
import pRetry, { AbortError } from "p-retry";
import { USER_AGENT } from "../shared/http.js";
import {
  checkFfmpeg,
  downloadSegmentsToFile,
  getSegmentUrls,
  mergeVideoAudio,
  parseHlsMasterPlaylist,
  type DownloadResult,
  type FetchResult,
  type ProgressCallback,
  type VideoInfo,
} from "./shared/index.js";

// ============================================================================
// Types
// ============================================================================

export interface LoomVideoInfo extends VideoInfo {
  hlsUrl: string; // Loom always has HLS
}

export interface LoomFetchResult extends FetchResult<LoomVideoInfo> {
  errorCode?:
    | "EMBED_FETCH_FAILED"
    | "HLS_NOT_FOUND"
    | "RATE_LIMITED"
    | "NETWORK_ERROR"
    | "PARSE_ERROR"
    | undefined;
  statusCode?: number | undefined;
}

export interface LoomDownloadResult extends DownloadResult {
  errorCode?:
    | LoomFetchResult["errorCode"]
    | "INVALID_URL"
    | "NO_VIDEO_STREAM"
    | "NO_SEGMENTS"
    | "DOWNLOAD_FAILED"
    | "MERGE_FAILED"
    | undefined;
}

// ============================================================================
// URL Extraction
// ============================================================================

/**
 * Extracts the Loom video ID from various URL formats.
 */
export function extractLoomId(url: string): string | null {
  const match = /loom\.com\/(?:embed|share)\/([a-f0-9]+)/.exec(url);
  return match?.[1] ?? null;
}

// ============================================================================
// Video Info Fetching
// ============================================================================

// Network I/O and file operations - excluded from coverage
/* v8 ignore start */

/**
 * Error class for Loom fetch failures with structured error info.
 */
class LoomFetchError extends Error {
  public readonly errorCode: NonNullable<LoomFetchResult["errorCode"]>;
  public readonly statusCode: number | undefined;
  public readonly details: string | undefined;

  constructor(
    message: string,
    errorCode: NonNullable<LoomFetchResult["errorCode"]>,
    statusCode?: number,
    details?: string
  ) {
    super(message);
    this.name = "LoomFetchError";
    this.errorCode = errorCode;
    this.statusCode = statusCode;
    this.details = details;
  }

  toResult(): LoomFetchResult {
    const result: LoomFetchResult = {
      success: false,
      error: this.message,
      errorCode: this.errorCode,
    };
    if (this.statusCode !== undefined) {
      result.statusCode = this.statusCode;
    }
    if (this.details !== undefined) {
      result.details = this.details;
    }
    return result;
  }
}

/**
 * Internal function to fetch Loom video info (throws on failure).
 */
async function fetchLoomVideoInfo(videoId: string): Promise<LoomVideoInfo> {
  const embedUrl = `https://www.loom.com/embed/${videoId}`;

  const embedResponse = await fetch(embedUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      "Cache-Control": "no-cache",
    },
  });

  if (embedResponse.status === 429) {
    throw new Error("Rate limited by Loom (429)");
  }

  if (embedResponse.status >= 400 && embedResponse.status < 500) {
    throw new AbortError(
      new LoomFetchError(
        `Loom returned HTTP ${embedResponse.status}`,
        "EMBED_FETCH_FAILED",
        embedResponse.status,
        `URL: ${embedUrl}`
      )
    );
  }

  if (!embedResponse.ok) {
    throw new Error(`Loom embed request failed with HTTP ${embedResponse.status}`);
  }

  const embedHtml = await embedResponse.text();

  if (embedHtml.includes("This video is private") || embedHtml.includes("video-not-found")) {
    throw new AbortError(
      new LoomFetchError(
        "Video is private or not found",
        "EMBED_FETCH_FAILED",
        200,
        "Loom returned a private/not-found page"
      )
    );
  }

  if (embedHtml.includes("rate limit") || embedHtml.includes("too many requests")) {
    throw new Error("Rate limited by Loom (detected in HTML)");
  }

  const hlsPatterns = [
    /"url":"(https:\/\/luna\.loom\.com\/[^"]+playlist\.m3u8[^"]*)"/,
    /"hlsUrl":"(https:\/\/[^"]+\.m3u8[^"]*)"/,
    /https:\/\/luna\.loom\.com\/[^"'\s]+playlist\.m3u8[^"'\s]*/,
  ];

  let hlsUrl: string | null = null;
  for (const pattern of hlsPatterns) {
    const match = embedHtml.match(pattern);
    if (match?.[1] || match?.[0]) {
      hlsUrl = (match[1] ?? match[0]).replace(/\\u0026/g, "&").replace(/\\\//g, "/");
      break;
    }
  }

  if (!hlsUrl) {
    const hasVideoTag = embedHtml.includes("<video");
    const hasLoomPlayer = embedHtml.includes("loom-player") || embedHtml.includes("LoomPlayer");
    const hasEmbedData =
      embedHtml.includes("__NEXT_DATA__") || embedHtml.includes("window.__LOOM__");
    const pageLength = embedHtml.length;

    throw new AbortError(
      new LoomFetchError(
        "Could not find HLS stream URL in embed page",
        "HLS_NOT_FOUND",
        200,
        `Page size: ${pageLength} bytes, Has video tag: ${hasVideoTag}, Has Loom player: ${hasLoomPlayer}, Has embed data: ${hasEmbedData}`
      )
    );
  }

  const oembedUrl = `https://www.loom.com/v1/oembed?url=https://www.loom.com/share/${videoId}`;
  let title = "Loom Video";
  let duration = 0;
  let width = 1920;
  let height = 1080;

  try {
    const oembedResponse = await fetch(oembedUrl, {
      headers: { "User-Agent": USER_AGENT },
    });

    if (oembedResponse.ok) {
      const data = (await oembedResponse.json()) as {
        title?: string;
        duration?: number;
        width?: number;
        height?: number;
      };
      title = data.title ?? title;
      duration = data.duration ?? duration;
      width = data.width ?? width;
      height = data.height ?? height;
    }
  } catch {
    // OEmbed failure is non-critical
  }

  return { id: videoId, title, duration, width, height, hlsUrl };
}

/**
 * Fetches video information from Loom's embed page with detailed error reporting.
 * Uses p-retry for automatic retries with exponential backoff.
 */
export async function getLoomVideoInfoDetailed(
  videoId: string,
  retryCount = 3,
  retryDelayMs = 1000
): Promise<LoomFetchResult> {
  try {
    const info = await pRetry(() => fetchLoomVideoInfo(videoId), {
      retries: retryCount,
      minTimeout: retryDelayMs,
      maxTimeout: retryDelayMs * 4,
      onFailedAttempt: (error) => {
        if (error.retriesLeft > 0) {
          console.log(
            `Loom fetch attempt ${error.attemptNumber} failed, ${error.retriesLeft} retries left`
          );
        }
      },
    });

    return { success: true, info };
  } catch (error) {
    if (error instanceof LoomFetchError) {
      return error.toResult();
    }

    if (error instanceof Error && error.cause instanceof LoomFetchError) {
      return error.cause.toResult();
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Network error: ${errorMessage}`,
      errorCode: "NETWORK_ERROR",
      details: `Failed after ${retryCount} attempts`,
    };
  }
}

// ============================================================================
// Video Download
// ============================================================================

/**
 * Downloads a Loom video using HLS.
 */
export async function downloadLoomVideo(
  urlOrId: string,
  outputPath: string,
  onProgress?: ProgressCallback
): Promise<LoomDownloadResult> {
  if (existsSync(outputPath)) {
    return { success: true };
  }

  let hlsUrl: string;
  let videoUrl: string | null = null;
  let audioUrl: string | null = null;

  if (urlOrId.includes("luna.loom.com") && urlOrId.includes(".m3u8")) {
    hlsUrl = urlOrId;

    if (hlsUrl.includes("mediaplaylist-video-")) {
      videoUrl = hlsUrl;
      audioUrl = hlsUrl.replace(/mediaplaylist-video-bitrate\d+\.m3u8/, "mediaplaylist-audio.m3u8");
    } else if (hlsUrl.includes("mediaplaylist-audio")) {
      hlsUrl = hlsUrl.replace(/mediaplaylist-audio\.m3u8/, "playlist.m3u8");
    }
  } else {
    const videoId = urlOrId.includes("loom.com") ? extractLoomId(urlOrId) : urlOrId;
    if (!videoId) {
      return { success: false, error: "Invalid Loom URL or ID", errorCode: "INVALID_URL" };
    }

    await delay(200 + Math.random() * 600);

    const fetchResult = await getLoomVideoInfoDetailed(videoId);
    if (!fetchResult.success || !fetchResult.info) {
      const result: LoomDownloadResult = {
        success: false,
        error: fetchResult.error ?? "Could not fetch video info from Loom",
      };
      if (fetchResult.errorCode) {
        result.errorCode = fetchResult.errorCode;
      }
      if (fetchResult.details) {
        result.details = fetchResult.details;
      }
      return result;
    }

    hlsUrl = fetchResult.info.hlsUrl;
  }

  if (!videoUrl) {
    const parsed = await parseHlsMasterPlaylist(hlsUrl);
    videoUrl = parsed.videoUrl;
    audioUrl = parsed.audioUrl;
  }

  if (!videoUrl) {
    return {
      success: false,
      error: "Could not find video stream in HLS playlist",
      errorCode: "NO_VIDEO_STREAM",
      details: `HLS URL: ${hlsUrl.substring(0, 80)}...`,
    };
  }

  const videoSegments = await getSegmentUrls(videoUrl);
  if (videoSegments.length === 0) {
    return {
      success: false,
      error: "No video segments found in playlist",
      errorCode: "NO_SEGMENTS",
      details: `Video playlist URL: ${videoUrl.substring(0, 80)}...`,
    };
  }

  const dir = dirname(outputPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  if (audioUrl) {
    const hasFfmpeg = await checkFfmpeg();

    if (hasFfmpeg) {
      const audioSegments = await getSegmentUrls(audioUrl);
      const tempId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const tempVideoPath = join(dir, `.temp-video-${tempId}.ts`);
      const tempAudioPath = join(dir, `.temp-audio-${tempId}.ts`);

      const totalSegments = videoSegments.length + audioSegments.length;
      let completed = 0;

      const videoSuccess = await downloadSegmentsToFile(videoSegments, tempVideoPath, {
        onProgress: (curr) => {
          completed = curr;
          onProgress?.({
            percent: (completed / totalSegments) * 100,
            phase: "downloading",
            downloadedSegments: completed,
            totalSegments,
          });
        },
      });

      if (!videoSuccess) {
        return {
          success: false,
          error: "Failed to download video segments",
          errorCode: "DOWNLOAD_FAILED",
          details: `Video had ${videoSegments.length} segments`,
        };
      }

      const audioSuccess = await downloadSegmentsToFile(audioSegments, tempAudioPath, {
        onProgress: (curr) => {
          completed = videoSegments.length + curr;
          onProgress?.({
            percent: (completed / totalSegments) * 100,
            phase: "downloading",
            downloadedSegments: completed,
            totalSegments,
          });
        },
      });

      if (!audioSuccess) {
        return {
          success: false,
          error: "Failed to download audio segments",
          errorCode: "DOWNLOAD_FAILED",
          details: `Audio had ${audioSegments.length} segments`,
        };
      }

      onProgress?.({ percent: 95, phase: "merging" });
      const mergeSuccess = await mergeVideoAudio(tempVideoPath, tempAudioPath, outputPath);
      if (!mergeSuccess) {
        return {
          success: false,
          error: "Failed to merge video and audio with ffmpeg",
          errorCode: "MERGE_FAILED",
        };
      }

      onProgress?.({ percent: 100, phase: "complete" });
      return { success: true };
    } else {
      console.warn("⚠️  ffmpeg not found - downloading video without audio");
    }
  }

  const success = await downloadSegmentsToFile(videoSegments, outputPath, {
    onProgress: (curr, total) => {
      onProgress?.({
        percent: (curr / total) * 100,
        phase: "downloading",
        downloadedSegments: curr,
        totalSegments: total,
      });
    },
  });

  if (!success) {
    return {
      success: false,
      error: "Failed to download video segments",
      errorCode: "DOWNLOAD_FAILED",
      details: `Video had ${videoSegments.length} segments`,
    };
  }

  onProgress?.({ percent: 100, phase: "complete" });
  return { success: true };
}

/* v8 ignore stop */
