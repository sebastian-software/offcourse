/**
 * Generic HLS video downloader.
 * Supports HighLevel and other HLS-based video platforms.
 */
import {
  checkFfmpeg,
  downloadSegmentsWithMerge,
  downloadWithFfmpeg,
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
/* v8 ignore next 80 */
export async function fetchHLSQualities(
  masterUrl: string,
  cookies?: string,
  referer?: string,
  authToken?: string
): Promise<HLSQuality[]> {
  try {
    const urlObj = new URL(masterUrl);
    const origin = referer ?? `${urlObj.protocol}//${urlObj.host}/`;

    const headers: Record<string, string> = {
      Origin: new URL(origin).origin,
      Referer: origin,
      Accept: "*/*",
    };
    if (cookies) {
      headers.Cookie = cookies;
    }
    if (authToken) {
      headers.APIKEY = authToken;
      headers.Authorization = `Bearer ${authToken}`;
    }

    const response = await fetch(masterUrl, {
      headers,
      redirect: "follow",
    });

    if (!response.ok) {
      console.error(`[HLS] Fetch failed: ${response.status} for ${masterUrl}`);
      return [];
    }

    const content = await response.text();
    const finalUrl = response.url;

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
            return await fetchHLSQualities(playlistUrl, cookies, referer, authToken);
          }
          const jsonStr = JSON.stringify(json);
          const cdnMatch =
            /(https?:\/\/[^"'\s]*(?:b-cdn\.net|mediadelivery\.net|vz-)[^"'\s]*)/i.exec(jsonStr);
          if (cdnMatch?.[1]) {
            return await fetchHLSQualities(cdnMatch[1], cookies, referer, authToken);
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
        return await fetchHLSQualities(cdnMatch[1], cookies, referer, authToken);
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
/* v8 ignore start */
export async function getBestQualityUrl(
  masterUrl: string,
  preferredHeight?: number,
  cookies?: string,
  referer?: string,
  authToken?: string
): Promise<string> {
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
    const urlObj = new URL(hlsUrl);
    const origin = referer ?? `${urlObj.protocol}//${urlObj.host}/`;

    const headers: Record<string, string> = {
      Origin: new URL(origin).origin,
      Referer: origin,
    };
    if (cookies) {
      headers.Cookie = cookies;
    }
    if (authToken) {
      headers.APIKEY = authToken;
      headers.Authorization = `Bearer ${authToken}`;
    }

    const testResponse = await fetch(hlsUrl, { headers, method: "HEAD" });
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
export async function downloadHighLevelVideo(
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
/* v8 ignore stop */

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
