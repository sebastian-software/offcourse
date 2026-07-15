/**
 * Generic HLS video downloader.
 * Supports HighLevel and other HLS-based video platforms.
 */
import {
  checkFfmpeg,
  downloadSegmentsWithMerge,
  downloadWithFfmpeg,
  fetchWithAuthRedirects,
  isSegmentsUrl,
  parseHLSPlaylist,
  parseSegmentsUrl,
  type DownloadResultWithDuration,
  type HLSQuality,
  type ProgressCallback,
} from "./shared/index.js";

// ============================================================================
// Types
// ============================================================================

export type HLSDownloadResult = DownloadResultWithDuration;

// ============================================================================
// HLS Quality Fetching
// ============================================================================

/**
 * Fetches an HLS master playlist and parses quality variants.
 */
export async function fetchHLSQualities(
  masterUrl: string,
  cookies?: string,
  referer?: string,
  authToken?: string
): Promise<HLSQuality[]> {
  let credentialOrigin: string;
  try {
    credentialOrigin = new URL(masterUrl).origin;
  } catch (error) {
    console.error("[HLS] Failed to fetch qualities:", error);
    return [];
  }

  return fetchHLSQualitiesInternal(masterUrl, cookies, referer, authToken, {
    credentialOrigin,
    depth: 0,
    visited: new Set(),
  });
}

interface HLSFetchState {
  credentialOrigin: string;
  depth: number;
  visited: Set<string>;
}

const MAX_PLAYLIST_DEPTH = 3;

async function fetchHLSQualitiesInternal(
  masterUrl: string,
  cookies: string | undefined,
  referer: string | undefined,
  authToken: string | undefined,
  state: HLSFetchState
): Promise<HLSQuality[]> {
  try {
    const normalizedUrl = new URL(masterUrl).href;
    if (state.depth > MAX_PLAYLIST_DEPTH || state.visited.has(normalizedUrl)) {
      console.error(`[HLS] Playlist recursion stopped for ${normalizedUrl}`);
      return [];
    }
    state.visited.add(normalizedUrl);

    const response = await fetchWithAuthRedirects(normalizedUrl, {
      cookies,
      referer,
      authToken,
      credentialOrigin: state.credentialOrigin,
    });

    if (!response.ok) {
      console.error(`[HLS] Fetch failed: ${response.status} for ${normalizedUrl}`);
      return [];
    }

    const content = await response.text();
    const finalUrl = response.url || normalizedUrl;

    if (!content.startsWith("#EXTM3U")) {
      if (content.startsWith("{") || content.startsWith("[")) {
        try {
          const json = JSON.parse(content) as Record<string, unknown>;
          const playlistUrl =
            (json.playlist as string | undefined) ??
            (json.url as string | undefined) ??
            (json.playlistUrl as string | undefined) ??
            (json.hlsUrl as string | undefined) ??
            (json.src as string | undefined) ??
            (json.source as string | undefined);
          if (playlistUrl && typeof playlistUrl === "string") {
            return await fetchHLSQualitiesInternal(
              new URL(playlistUrl, finalUrl).href,
              cookies,
              referer,
              authToken,
              { ...state, depth: state.depth + 1 }
            );
          }
          const jsonStr = JSON.stringify(json);
          const cdnMatch =
            /(https?:\/\/[^"'\s]*(?:b-cdn\.net|mediadelivery\.net|vz-)[^"'\s]*)/i.exec(jsonStr);
          if (cdnMatch?.[1]) {
            return await fetchHLSQualitiesInternal(cdnMatch[1], cookies, referer, authToken, {
              ...state,
              depth: state.depth + 1,
            });
          }
        } catch {
          // Not valid JSON
        }
      }

      const cdnMatch =
        /(https?:\/\/[^"'\s<>]*(?:b-cdn\.net|mediadelivery\.net|vz-)[^"'\s<>]*\.m3u8[^"'\s<>]*)/i.exec(
          content
        );
      if (cdnMatch?.[1]) {
        return await fetchHLSQualitiesInternal(cdnMatch[1], cookies, referer, authToken, {
          ...state,
          depth: state.depth + 1,
        });
      }

      console.error(`[HLS] Invalid playlist (starts with: ${content.substring(0, 50)}...)`);
      return [];
    }

    return parseHLSPlaylist(content, finalUrl);
  } catch (error) {
    console.error("[HLS] Failed to fetch qualities:", error);
    return [];
  }
}

/**
 * Gets the best quality URL from a master playlist.
 */
export async function getBestQualityUrl(
  masterUrl: string,
  preferredHeight?: number,
  cookies?: string,
  referer?: string,
  authToken?: string
): Promise<string> {
  if (isSegmentsUrl(masterUrl)) {
    return masterUrl;
  }

  const qualities = await fetchHLSQualities(masterUrl, cookies, referer, authToken);

  if (qualities.length === 0) {
    return masterUrl;
  }

  if (preferredHeight) {
    const match = qualities.find((q) => q.height === preferredHeight);
    if (match) return match.url;

    const lower = qualities.filter((q) => q.height && q.height <= preferredHeight);
    const closest = lower[0];
    if (closest) {
      return closest.url;
    }
  }

  return qualities[0]?.url ?? masterUrl;
}

// ============================================================================
// HLS Download
// ============================================================================

/**
 * Downloads an HLS stream using ffmpeg.
 */
export async function downloadHLSVideo(
  hlsUrl: string,
  outputPath: string,
  onProgress?: ProgressCallback,
  cookies?: string,
  referer?: string,
  authToken?: string
): Promise<HLSDownloadResult> {
  const hasFfmpeg = await checkFfmpeg();
  if (!hasFfmpeg) {
    return {
      success: false,
      error: "ffmpeg is not installed. Please install ffmpeg to download HLS videos.",
      errorCode: "FFMPEG_NOT_FOUND",
    };
  }

  if (isSegmentsUrl(hlsUrl)) {
    const segmentUrls = parseSegmentsUrl(hlsUrl);
    if (!segmentUrls) {
      return {
        success: false,
        error: "Failed to decode segment URLs",
        errorCode: "PARSE_ERROR",
      };
    }
    return downloadSegmentsWithMerge(segmentUrls, outputPath, { onProgress });
  }

  try {
    const testResponse = await fetchWithAuthRedirects(hlsUrl, {
      cookies,
      referer,
      authToken,
      credentialOrigin: new URL(hlsUrl).origin,
      method: "HEAD",
    });
    if (!testResponse.ok) {
      return {
        success: false,
        error: `HLS URL returned ${testResponse.status}: ${hlsUrl}`,
        errorCode: "FETCH_FAILED",
      };
    }
  } catch (error) {
    return {
      success: false,
      error: `Failed to validate HLS URL: ${error instanceof Error ? error.message : String(error)}`,
      errorCode: "NETWORK_ERROR",
    };
  }

  const result = await downloadWithFfmpeg(hlsUrl, outputPath, {
    cookies,
    referer,
    authToken,
    onProgress,
  });

  if (!result.success) {
    return {
      success: false,
      error: result.error ?? "Unknown ffmpeg error",
      errorCode: "FFMPEG_ERROR",
    };
  }

  return {
    success: true,
    outputPath,
    duration: result.duration,
  };
}

/**
 * Downloads a HighLevel HLS video with quality selection.
 */
export async function downloadHLSVideoWithQuality(
  masterUrl: string,
  outputPath: string,
  preferredQuality?: string,
  onProgress?: ProgressCallback,
  cookies?: string,
  referer?: string,
  authToken?: string
): Promise<HLSDownloadResult> {
  onProgress?.({ phase: "preparing", percent: 0 });

  let preferredHeight: number | undefined;
  if (preferredQuality) {
    const match = /(\d+)p?/i.exec(preferredQuality);
    if (match?.[1]) {
      preferredHeight = parseInt(match[1], 10);
    }
  }

  let downloadUrl = masterUrl;
  try {
    downloadUrl = await getBestQualityUrl(masterUrl, preferredHeight, cookies, referer, authToken);
  } catch (error) {
    console.warn("Failed to fetch quality options, using master URL:", error);
  }

  return downloadHLSVideo(downloadUrl, outputPath, onProgress, cookies, referer, authToken);
}

/**
 * Backwards-compatible HighLevel name for the generic quality-aware HLS downloader.
 */
export async function downloadHighLevelVideo(
  masterUrl: string,
  outputPath: string,
  preferredQuality?: string,
  onProgress?: ProgressCallback,
  cookies?: string,
  referer?: string,
  authToken?: string
): Promise<HLSDownloadResult> {
  return downloadHLSVideoWithQuality(
    masterUrl,
    outputPath,
    preferredQuality,
    onProgress,
    cookies,
    referer,
    authToken
  );
}

// ============================================================================
// URL Parsing
// ============================================================================

/**
 * Extracts video info from a HighLevel HLS URL.
 */
export function parseHighLevelVideoUrl(url: string): {
  locationId: string;
  videoId: string;
  token?: string | undefined;
} | null {
  try {
    const urlObj = new URL(url);

    const match = /\/memberships\/([^/]+)\/videos\/([^/,]+)/.exec(urlObj.pathname);
    const locationId = match?.[1];
    const videoId = match?.[2];

    if (!locationId || !videoId) {
      return null;
    }

    const token = urlObj.searchParams.get("token");

    return {
      locationId,
      videoId,
      ...(token ? { token } : {}),
    };
  } catch {
    return null;
  }
}
