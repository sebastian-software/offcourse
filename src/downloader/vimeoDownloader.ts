import { createWriteStream, existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

export interface VimeoVideoInfo {
  id: string;
  title: string;
  duration: number;
  width: number;
  height: number;
  hlsUrl: string | null;
  progressiveUrl: string | null;
}

export interface VimeoFetchResult {
  success: boolean;
  info?: VimeoVideoInfo;
  error?: string;
  errorCode?: "VIDEO_NOT_FOUND" | "DRM_PROTECTED" | "PRIVATE_VIDEO" | "RATE_LIMITED" | "NETWORK_ERROR" | "PARSE_ERROR";
  details?: string;
}

export interface DownloadProgress {
  percent: number;
  downloaded: number;
  total: number;
}

export interface VimeoDownloadResult {
  success: boolean;
  error?: string;
  errorCode?: VimeoFetchResult["errorCode"] | "INVALID_URL" | "NO_STREAM" | "DOWNLOAD_FAILED";
  details?: string;
}

/**
 * Extracts the Vimeo video ID from various URL formats.
 */
export function extractVimeoId(url: string): string | null {
  // Handle various Vimeo URL formats:
  // https://vimeo.com/123456789
  // https://vimeo.com/123456789?share=copy
  // https://player.vimeo.com/video/123456789
  // https://vimeo.com/channels/xxx/123456789
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
 * Extracts the unlisted hash from a Vimeo URL if present.
 * Unlisted videos require this hash to access.
 */
function extractUnlistedHash(url: string): string | null {
  // Format: https://vimeo.com/123456789/abcdef1234
  // Or in player: https://player.vimeo.com/video/123456789?h=abcdef1234
  const pathMatch = url.match(/vimeo\.com\/\d+\/([a-f0-9]+)/);
  if (pathMatch?.[1]) {
    return pathMatch[1];
  }

  const paramMatch = url.match(/[?&]h=([a-f0-9]+)/);
  if (paramMatch?.[1]) {
    return paramMatch[1];
  }

  return null;
}

/**
 * Fetches video information from Vimeo's player config.
 * @param referer - Optional referer URL (e.g., the Skool page URL) for domain-restricted videos
 */
export async function getVimeoVideoInfo(
  videoId: string,
  unlistedHash?: string | null,
  referer?: string
): Promise<VimeoFetchResult> {
  // Try the config endpoint first
  let configUrl = `https://player.vimeo.com/video/${videoId}/config`;
  if (unlistedHash) {
    configUrl += `?h=${unlistedHash}`;
  }

  // Build headers - use provided referer for domain-restricted videos
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
  };

  // Try with Skool referer first if provided, otherwise use Vimeo's player
  if (referer) {
    headers["Referer"] = referer;
    headers["Origin"] = new URL(referer).origin;
  } else {
    headers["Referer"] = "https://player.vimeo.com/";
  }

  try {
    let response = await fetch(configUrl, { headers });

    // If we got 403 with a custom referer, the video might be strictly domain-locked
    // Try with the embed page URL as referer
    if (response.status === 403 && referer) {
      headers["Referer"] = `https://player.vimeo.com/video/${videoId}`;
      headers["Origin"] = "https://player.vimeo.com";
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

    const config = await response.json() as VimeoConfig;

    // Check for DRM
    if (config.request?.files?.dash?.cdns && !config.request?.files?.hls && !config.request?.files?.progressive) {
      // Only DASH with no HLS/progressive usually means DRM
      const hasDrm = config.video?.drm || config.request?.drm;
      if (hasDrm) {
        return {
          success: false,
          error: "Video is DRM protected and cannot be downloaded",
          errorCode: "DRM_PROTECTED",
          details: `Video "${config.video?.title ?? videoId}" uses DRM protection. This video cannot be downloaded without the content provider's authorization.`,
        };
      }
    }

    // Extract HLS URL
    let hlsUrl: string | null = null;
    const hlsCdns = config.request?.files?.hls?.cdns;
    if (hlsCdns) {
      // Prefer akamai_live, then fastly, then any available CDN
      const preferredCdns = ["akfire_interconnect_quic", "akamai_live", "fastly_skyfire", "fastly"];
      for (const cdn of preferredCdns) {
        if (hlsCdns[cdn]?.url) {
          hlsUrl = hlsCdns[cdn].url;
          break;
        }
      }
      // Fallback to any CDN
      if (!hlsUrl) {
        const cdnKeys = Object.keys(hlsCdns);
        const firstCdn = cdnKeys[0];
        if (firstCdn) {
          const cdnUrl = hlsCdns[firstCdn]?.url;
          if (cdnUrl) {
            hlsUrl = cdnUrl;
          }
        }
      }
    }

    // Extract progressive (direct MP4) URL - prefer highest quality
    let progressiveUrl: string | null = null;
    const progressive = config.request?.files?.progressive;
    if (progressive && Array.isArray(progressive) && progressive.length > 0) {
      // Sort by height descending to get best quality
      const sorted = [...progressive].sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
      progressiveUrl = sorted[0]?.url ?? null;
    }

    if (!hlsUrl && !progressiveUrl) {
      // Check if this is a DRM-only video
      if (config.request?.files?.dash) {
        return {
          success: false,
          error: "Video only has DRM-protected DASH streams",
          errorCode: "DRM_PROTECTED",
          details: `Video "${config.video?.title ?? videoId}" appears to use DRM protection. No downloadable streams available.`,
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
 * Uses page.request API which runs at browser level (no CORS restrictions)
 * and includes the browser's cookies/session.
 *
 * @param page - Playwright page (should be on the Skool lesson page)
 * @param videoId - Vimeo video ID
 * @param unlistedHash - Optional hash for unlisted videos
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
    // Use page.request (Playwright API) - runs at browser level, no CORS issues
    // and includes the browser's cookies/session
    const currentUrl = page.url();
    const response = await page.request.get(configUrl, {
      headers: {
        "Accept": "application/json",
        "Referer": currentUrl,
        "Origin": new URL(currentUrl).origin,
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

    const config = await response.json() as VimeoConfig;

    // Extract HLS URL (same logic as getVimeoVideoInfo)
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
        const cdnKeys = Object.keys(hlsCdns);
        const firstCdn = cdnKeys[0];
        if (firstCdn) {
          const cdnUrl = hlsCdns[firstCdn]?.url;
          if (cdnUrl) {
            hlsUrl = cdnUrl;
          }
        }
      }
    }

    // Extract progressive URL
    let progressiveUrl: string | null = null;
    const progressive = config.request?.files?.progressive;
    if (progressive && Array.isArray(progressive) && progressive.length > 0) {
      const sorted = [...progressive].sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
      progressiveUrl = sorted[0]?.url ?? null;
    }

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
        error: "No downloadable streams found",
        errorCode: "PARSE_ERROR",
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
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      errorCode: "NETWORK_ERROR",
    };
  }
}

/**
 * Downloads a Vimeo video.
 * Prefers progressive (direct MP4) download, falls back to HLS.
 */
export async function downloadVimeoVideo(
  url: string,
  outputPath: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<VimeoDownloadResult> {
  if (existsSync(outputPath)) {
    return { success: true };
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

  // Ensure output directory exists
  const dir = dirname(outputPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Prefer progressive (direct MP4) download - simpler and often better quality
  if (info.progressiveUrl) {
    const result = await downloadProgressiveVideo(info.progressiveUrl, outputPath, onProgress);
    if (result.success) {
      return result;
    }
    // Fall through to HLS if progressive fails
  }

  // Try HLS download
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
 * Downloads a progressive (direct) video file.
 */
async function downloadProgressiveVideo(
  url: string,
  outputPath: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<VimeoDownloadResult> {
  const tempPath = `${outputPath}.tmp`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Referer": "https://player.vimeo.com/",
      },
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Download failed: HTTP ${response.status}`,
        errorCode: "DOWNLOAD_FAILED",
      };
    }

    const contentLength = response.headers.get("content-length");
    const total = contentLength ? parseInt(contentLength, 10) : 0;

    if (!response.body) {
      return {
        success: false,
        error: "No response body",
        errorCode: "DOWNLOAD_FAILED",
      };
    }

    const fileStream = createWriteStream(tempPath);
    const reader = response.body.getReader();
    let downloaded = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      fileStream.write(Buffer.from(value));
      downloaded += value.length;

      if (onProgress && total > 0) {
        onProgress({
          percent: (downloaded / total) * 100,
          downloaded,
          total,
        });
      }
    }

    await new Promise<void>((resolve, reject) => {
      fileStream.end((err: Error | null) => (err ? reject(err) : resolve()));
    });

    renameSync(tempPath, outputPath);
    return { success: true };
  } catch (error) {
    if (existsSync(tempPath)) {
      unlinkSync(tempPath);
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      errorCode: "DOWNLOAD_FAILED",
    };
  }
}

/**
 * Downloads an HLS video stream.
 */
async function downloadHlsVideo(
  masterUrl: string,
  outputPath: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<VimeoDownloadResult> {
  try {
    // Fetch master playlist
    const masterResponse = await fetch(masterUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://player.vimeo.com/",
      },
    });

    if (!masterResponse.ok) {
      return {
        success: false,
        error: `Failed to fetch HLS playlist: HTTP ${masterResponse.status}`,
        errorCode: "DOWNLOAD_FAILED",
      };
    }

    const masterPlaylist = await masterResponse.text();
    const lines = masterPlaylist.split("\n");
    const baseUrl = masterUrl.substring(0, masterUrl.lastIndexOf("/") + 1);

    // Find best quality video stream
    let bestBandwidth = 0;
    let videoPlaylistUrl: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]?.trim();
      if (!line) continue;

      if (line.startsWith("#EXT-X-STREAM-INF:")) {
        const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
        const bandwidth = bandwidthMatch?.[1] ? parseInt(bandwidthMatch[1], 10) : 0;

        const nextLine = lines[i + 1]?.trim();
        if (nextLine && !nextLine.startsWith("#") && bandwidth > bestBandwidth) {
          bestBandwidth = bandwidth;
          videoPlaylistUrl = nextLine.startsWith("http") ? nextLine : baseUrl + nextLine;
        }
      }
    }

    if (!videoPlaylistUrl) {
      return {
        success: false,
        error: "Could not find video stream in HLS playlist",
        errorCode: "DOWNLOAD_FAILED",
      };
    }

    // Fetch video playlist and get segments
    const videoResponse = await fetch(videoPlaylistUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    if (!videoResponse.ok) {
      return {
        success: false,
        error: `Failed to fetch video playlist: HTTP ${videoResponse.status}`,
        errorCode: "DOWNLOAD_FAILED",
      };
    }

    const videoPlaylist = await videoResponse.text();
    const videoBaseUrl = videoPlaylistUrl.substring(0, videoPlaylistUrl.lastIndexOf("/") + 1);
    const segments: string[] = [];

    for (const line of videoPlaylist.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const segmentUrl = trimmed.startsWith("http") ? trimmed : videoBaseUrl + trimmed;
        segments.push(segmentUrl);
      }
    }

    if (segments.length === 0) {
      return {
        success: false,
        error: "No segments found in video playlist",
        errorCode: "DOWNLOAD_FAILED",
      };
    }

    // Download all segments
    const tempPath = `${outputPath}.tmp`;
    const fileStream = createWriteStream(tempPath);

    for (let i = 0; i < segments.length; i++) {
      const segmentUrl = segments[i];
      if (!segmentUrl) continue;

      const segResponse = await fetch(segmentUrl, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });

      if (!segResponse.ok || !segResponse.body) continue;

      const reader = segResponse.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fileStream.write(Buffer.from(value));
      }

      if (onProgress) {
        onProgress({
          percent: ((i + 1) / segments.length) * 100,
          downloaded: i + 1,
          total: segments.length,
        });
      }
    }

    await new Promise<void>((resolve, reject) => {
      fileStream.end((err: Error | null) => (err ? reject(err) : resolve()));
    });

    renameSync(tempPath, outputPath);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      errorCode: "DOWNLOAD_FAILED",
    };
  }
}

/**
 * Vimeo config response type (partial).
 */
interface VimeoConfig {
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
      progressive?: Array<{
        url?: string;
        quality?: string;
        width?: number;
        height?: number;
      }>;
    };
  };
}

