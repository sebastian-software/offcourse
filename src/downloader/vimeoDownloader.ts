/**
 * Vimeo video downloader.
 * Downloads videos from Vimeo using progressive or HLS streaming.
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { USER_AGENT } from "../shared/http.js";
import {
  checkFfmpeg,
  downloadProgressiveVideo,
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

export interface VimeoVideoInfo extends VideoInfo {
  progressiveUrl: string | null;
}

export interface VimeoFetchResult extends FetchResult<VimeoVideoInfo> {
  errorCode?:
    | "VIDEO_NOT_FOUND"
    | "DRM_PROTECTED"
    | "PRIVATE_VIDEO"
    | "RATE_LIMITED"
    | "NETWORK_ERROR"
    | "PARSE_ERROR"
    | undefined;
}

export interface VimeoDownloadResult extends DownloadResult {
  errorCode?:
    VimeoFetchResult["errorCode"] | "INVALID_URL" | "NO_STREAM" | "DOWNLOAD_FAILED" | undefined;
}

export interface VimeoConfig {
  video?: {
    id?: number;
    title?: string;
    duration?: number;
    width?: number;
    height?: number;
    drm?: boolean;
  };
  request?: {
    drm?: boolean;
    files?: {
      hls?: {
        cdns?: Record<string, { url?: string }>;
      };
      dash?: {
        cdns?: Record<string, { url?: string }>;
      };
      progressive?: {
        url?: string;
        quality?: string;
        width?: number;
        height?: number;
      }[];
    };
  };
}

// ============================================================================
// URL Extraction
// ============================================================================

/**
 * Extracts the Vimeo video ID from various URL formats.
 */
export function extractVimeoId(url: string): string | null {
  const patterns = [
    /vimeo\.com\/(?:video\/)?(\d+)/,
    /player\.vimeo\.com\/video\/(\d+)/,
    /vimeo\.com\/channels\/[^/]+\/(\d+)/,
    /vimeo\.com\/groups\/[^/]+\/videos\/(\d+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

/**
 * Selects Vimeo's preferred HLS CDN and highest progressive rendition.
 */
export function parseVimeoConfig(config: VimeoConfig, videoId: string): VimeoFetchResult {
  let hlsUrl: string | null = null;
  const hlsCdns = config.request?.files?.hls?.cdns;
  if (hlsCdns) {
    const preferredCdns = ["akfire_interconnect_quic", "akamai_live", "fastly_skyfire", "fastly"];
    for (const cdn of preferredCdns) {
      if (hlsCdns[cdn]?.url) {
        hlsUrl = hlsCdns[cdn].url;
        break;
      }
    }

    if (!hlsUrl) {
      const firstCdn = Object.keys(hlsCdns)[0];
      if (firstCdn) hlsUrl = hlsCdns[firstCdn]?.url ?? null;
    }
  }

  const progressive = config.request?.files?.progressive;
  const progressiveUrl =
    progressive && progressive.length > 0
      ? ([...progressive].sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0]?.url ?? null)
      : null;

  if (!hlsUrl && !progressiveUrl) {
    if (config.request?.files?.dash) {
      return {
        success: false,
        error: "Video only has DRM-protected DASH streams",
        errorCode: "DRM_PROTECTED",
        details: `Video "${config.video?.title ?? videoId}" uses DRM. Cannot download.`,
      };
    }

    return {
      success: false,
      error: "No downloadable video streams found",
      errorCode: "PARSE_ERROR",
      details: "Could not find HLS or progressive download URLs in config",
    };
  }

  return {
    success: true,
    info: {
      id: videoId,
      title: config.video?.title ?? "Vimeo Video",
      duration: config.video?.duration ?? 0,
      width: config.video?.width ?? 1920,
      height: config.video?.height ?? 1080,
      hlsUrl,
      progressiveUrl,
    },
  };
}

// ============================================================================
// Video Info Fetching
// ============================================================================

// Network I/O and file operations - excluded from coverage
/* v8 ignore start */

/**
 * Extracts the unlisted hash from a Vimeo URL if present.
 */
function extractUnlistedHash(url: string): string | null {
  const pathMatch = /vimeo\.com\/\d+\/([a-f0-9]+)/.exec(url);
  if (pathMatch?.[1]) {
    return pathMatch[1];
  }

  const paramMatch = /[?&]h=([a-f0-9]+)/.exec(url);
  if (paramMatch?.[1]) {
    return paramMatch[1];
  }

  return null;
}

/**
 * Fetches video information from Vimeo's player config.
 */
export async function getVimeoVideoInfo(
  videoId: string,
  unlistedHash?: string | null,
  referer?: string
): Promise<VimeoFetchResult> {
  let configUrl = `https://player.vimeo.com/video/${videoId}/config`;
  if (unlistedHash) {
    configUrl += `?h=${unlistedHash}`;
  }

  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "application/json",
  };

  if (referer) {
    headers.Referer = referer;
    headers.Origin = new URL(referer).origin;
  } else {
    headers.Referer = "https://player.vimeo.com/";
  }

  try {
    let response = await fetch(configUrl, { headers });

    if (response.status === 403 && referer) {
      headers.Referer = `https://player.vimeo.com/video/${videoId}`;
      headers.Origin = "https://player.vimeo.com";
      response = await fetch(configUrl, { headers });
    }

    if (response.status === 404) {
      return {
        success: false,
        error: "Video not found",
        errorCode: "VIDEO_NOT_FOUND",
        details: `Video ID: ${videoId}`,
      };
    }

    if (response.status === 403) {
      return {
        success: false,
        error: "Video is private or requires authentication",
        errorCode: "PRIVATE_VIDEO",
        details: `Video ID: ${videoId}. This video may require login or is restricted.`,
      };
    }

    if (response.status === 429) {
      return {
        success: false,
        error: "Rate limited by Vimeo",
        errorCode: "RATE_LIMITED",
      };
    }

    if (!response.ok) {
      return {
        success: false,
        error: `Vimeo returned HTTP ${response.status}`,
        errorCode: "NETWORK_ERROR",
        details: `Config URL: ${configUrl}`,
      };
    }

    const config = (await response.json()) as VimeoConfig;

    return parseVimeoConfig(config, videoId);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Network error: ${errorMessage}`,
      errorCode: "NETWORK_ERROR",
    };
  }
}

/**
 * Fetches Vimeo config from within a Playwright browser context.
 */
export async function getVimeoVideoInfoFromBrowser(
  page: import("playwright").Page,
  videoId: string,
  unlistedHash?: string | null
): Promise<VimeoFetchResult> {
  let configUrl = `https://player.vimeo.com/video/${videoId}/config`;
  if (unlistedHash) {
    configUrl += `?h=${unlistedHash}`;
  }

  try {
    const currentUrl = page.url();
    const response = await page.request.get(configUrl, {
      headers: {
        Accept: "application/json",
        Referer: currentUrl,
        Origin: new URL(currentUrl).origin,
      },
    });

    if (response.status() === 403) {
      return {
        success: false,
        error: "Video is private or requires authentication",
        errorCode: "PRIVATE_VIDEO",
        details: `Video ID: ${videoId}. Domain-restricted even with browser session.`,
      };
    }

    if (response.status() === 404) {
      return {
        success: false,
        error: "Video not found",
        errorCode: "VIDEO_NOT_FOUND",
        details: `Video ID: ${videoId}`,
      };
    }

    if (!response.ok()) {
      return {
        success: false,
        error: `Vimeo returned HTTP ${response.status()}`,
        errorCode: "NETWORK_ERROR",
        details: `Config URL: ${configUrl}`,
      };
    }

    const config = (await response.json()) as VimeoConfig;

    return parseVimeoConfig(config, videoId);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      errorCode: "NETWORK_ERROR",
    };
  }
}

// ============================================================================
// Video Download
// ============================================================================

/**
 * Downloads a Vimeo video.
 * Prefers progressive (direct MP4) download, falls back to HLS.
 */
export async function downloadVimeoVideo(
  url: string,
  outputPath: string,
  onProgress?: ProgressCallback
): Promise<VimeoDownloadResult> {
  if (existsSync(outputPath)) {
    return { success: true };
  }

  if (url.includes("vimeocdn.com") && url.includes(".m3u8")) {
    const dir = dirname(outputPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    return downloadHlsVideo(url, outputPath, onProgress);
  }

  const videoId = extractVimeoId(url);
  if (!videoId) {
    return {
      success: false,
      error: "Invalid Vimeo URL",
      errorCode: "INVALID_URL",
      details: `Could not extract video ID from: ${url}`,
    };
  }

  const unlistedHash = extractUnlistedHash(url);
  const fetchResult = await getVimeoVideoInfo(videoId, unlistedHash);

  if (!fetchResult.success || !fetchResult.info) {
    const result: VimeoDownloadResult = {
      success: false,
      error: fetchResult.error ?? "Could not fetch video info",
    };
    if (fetchResult.errorCode) {
      result.errorCode = fetchResult.errorCode;
    }
    if (fetchResult.details) {
      result.details = fetchResult.details;
    }
    return result;
  }

  const info = fetchResult.info;

  const dir = dirname(outputPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  if (info.progressiveUrl) {
    const result = await downloadProgressiveVideo(info.progressiveUrl, outputPath, {
      onProgress,
      referer: "https://player.vimeo.com/",
    });
    if (result.success) {
      return { success: true };
    }
  }

  if (info.hlsUrl) {
    return downloadHlsVideo(info.hlsUrl, outputPath, onProgress);
  }

  return {
    success: false,
    error: "No downloadable streams available",
    errorCode: "NO_STREAM",
  };
}

/**
 * Downloads an HLS video stream.
 */
async function downloadHlsVideo(
  masterUrl: string,
  outputPath: string,
  onProgress?: ProgressCallback
): Promise<VimeoDownloadResult> {
  try {
    const headers = { Referer: "https://player.vimeo.com/" };
    const { videoUrl, audioUrl } = await parseHlsMasterPlaylist(masterUrl, headers);

    if (!videoUrl) {
      return {
        success: false,
        error: "Could not find video stream in HLS playlist",
        errorCode: "DOWNLOAD_FAILED",
      };
    }

    const videoSegments = await getSegmentUrls(videoUrl, headers);
    if (videoSegments.length === 0) {
      return {
        success: false,
        error: "No segments found in video playlist",
        errorCode: "DOWNLOAD_FAILED",
      };
    }

    if (audioUrl) {
      const audioSegments = await getSegmentUrls(audioUrl, headers);
      if (audioSegments.length === 0) {
        return {
          success: false,
          error: "No segments found in Vimeo audio playlist",
          errorCode: "DOWNLOAD_FAILED",
        };
      }

      if (!(await checkFfmpeg())) {
        return {
          success: false,
          error: "ffmpeg is required to merge Vimeo's separate video and audio streams",
          errorCode: "DOWNLOAD_FAILED",
        };
      }

      const dir = dirname(outputPath);
      const tempId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const tempVideoPath = join(dir, `.vimeo-video-${tempId}.ts`);
      const tempAudioPath = join(dir, `.vimeo-audio-${tempId}.ts`);
      const cleanup = () => {
        rmSync(tempVideoPath, { force: true });
        rmSync(tempAudioPath, { force: true });
      };
      const totalSegments = videoSegments.length + audioSegments.length;

      const videoSuccess = await downloadSegmentsToFile(videoSegments, tempVideoPath, {
        headers,
        onProgress: (current) => {
          onProgress?.({
            percent: (current / totalSegments) * 90,
            phase: "downloading",
            downloadedSegments: current,
            totalSegments,
          });
        },
      });
      if (!videoSuccess) {
        cleanup();
        return {
          success: false,
          error: "Failed to download Vimeo video segments",
          errorCode: "DOWNLOAD_FAILED",
        };
      }

      const audioSuccess = await downloadSegmentsToFile(audioSegments, tempAudioPath, {
        headers,
        onProgress: (current) => {
          const completed = videoSegments.length + current;
          onProgress?.({
            percent: (completed / totalSegments) * 90,
            phase: "downloading",
            downloadedSegments: completed,
            totalSegments,
          });
        },
      });
      if (!audioSuccess) {
        cleanup();
        return {
          success: false,
          error: "Failed to download Vimeo audio segments",
          errorCode: "DOWNLOAD_FAILED",
        };
      }

      onProgress?.({ percent: 95, phase: "merging" });
      const mergeSuccess = await mergeVideoAudio(tempVideoPath, tempAudioPath, outputPath);
      if (!mergeSuccess) {
        cleanup();
        return {
          success: false,
          error: "Failed to merge Vimeo video and audio",
          errorCode: "DOWNLOAD_FAILED",
        };
      }

      onProgress?.({ percent: 100, phase: "complete" });
      return { success: true };
    }

    const success = await downloadSegmentsToFile(videoSegments, outputPath, {
      headers,
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
      };
    }

    onProgress?.({ percent: 100, phase: "complete" });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      errorCode: "DOWNLOAD_FAILED",
    };
  }
}

/* v8 ignore stop */
