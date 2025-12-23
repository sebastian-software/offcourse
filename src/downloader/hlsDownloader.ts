import * as fs from "node:fs";
import * as path from "node:path";
import { execa } from "execa";
import * as HLS from "hls-parser";
import type { DownloadProgress } from "./loomDownloader.js";

export interface HLSDownloadResult {
  success: boolean;
  error?: string;
  errorCode?: string;
  outputPath?: string;
  duration?: number;
}

export interface HLSQuality {
  label: string;
  url: string;
  bandwidth: number;
  width?: number | undefined;
  height?: number | undefined;
}

/**
 * Checks if ffmpeg is available on the system.
 */
/* v8 ignore next 8 */
export async function checkFfmpeg(): Promise<boolean> {
  try {
    await execa("ffmpeg", ["-version"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetches an HLS master playlist and parses quality variants.
 */
/* v8 ignore next 24 */
export async function fetchHLSQualities(
  masterUrl: string,
  cookies?: string,
  referer?: string,
  authToken?: string
): Promise<HLSQuality[]> {
  try {
    // Use provided referer or extract origin from URL
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
    // Add auth token as APIKEY header (used by LearningSuite)
    if (authToken) {
      headers.APIKEY = authToken;
      headers.Authorization = `Bearer ${authToken}`;
    }

    // Follow redirects manually to capture the final URL
    const response = await fetch(masterUrl, {
      headers,
      redirect: "follow",
    });

    if (!response.ok) {
      console.error(`[HLS] Fetch failed: ${response.status} for ${masterUrl}`);
      return [];
    }

    const content = await response.text();
    const finalUrl = response.url; // URL after redirects

    // Debug: Check if response is valid HLS
    if (!content.startsWith("#EXTM3U")) {
      // Check if it's JSON (Bunny CDN API response)
      if (content.startsWith("{") || content.startsWith("[")) {
        try {
          const json = JSON.parse(content) as Record<string, unknown>;
          // Try to extract actual playlist URL from JSON - check various field names
          const playlistUrl =
            (json.playlist as string | undefined) ??
            (json.url as string | undefined) ??
            (json.playlistUrl as string | undefined) ??
            (json.hlsUrl as string | undefined) ??
            (json.src as string | undefined) ??
            (json.source as string | undefined);
          if (playlistUrl && typeof playlistUrl === "string") {
            // Recursively fetch the actual playlist
            return await fetchHLSQualities(playlistUrl, cookies, referer, authToken);
          }
          // Look for CDN URL anywhere in the JSON string
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

      // Check if content contains a redirect URL or CDN URL
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
 * Parses an HLS master playlist to extract quality variants.
 * Uses hls-parser for robust parsing.
 */
export function parseHLSPlaylist(content: string, baseUrl: string): HLSQuality[] {
  try {
    const playlist = HLS.parse(content);

    // Check if it's a master playlist with variants
    if (!("variants" in playlist) || !playlist.variants) {
      return [];
    }

    const variants: HLSQuality[] = playlist.variants.map((variant) => {
      const bandwidth = variant.bandwidth ?? 0;
      const resolution = variant.resolution;
      const width = resolution?.width;
      const height = resolution?.height;

      // Build absolute URL
      const variantUrl = variant.uri.startsWith("http")
        ? variant.uri
        : new URL(variant.uri, baseUrl).href;

      const label = height ? `${height}p` : `${Math.round(bandwidth / 1000)}k`;

      return {
        label,
        url: variantUrl,
        bandwidth,
        width,
        height,
      };
    });

    // Sort by bandwidth (highest first)
    variants.sort((a, b) => b.bandwidth - a.bandwidth);

    return variants;
  } catch {
    // Fallback to empty array on parse error
    return [];
  }
}

/**
 * Gets the best quality URL from a master playlist.
 * @param masterUrl The master playlist URL
 * @param preferredHeight Preferred video height (e.g., 720, 1080)
 * @param cookies Optional cookies for authenticated requests
 * @param referer Optional referer URL
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
    // Assume it's a direct media playlist
    return masterUrl;
  }

  if (preferredHeight) {
    // Find closest match to preferred height
    const match = qualities.find((q) => q.height === preferredHeight);
    if (match) return match.url;

    // Find closest lower quality
    const lower = qualities.filter((q) => q.height && q.height <= preferredHeight);
    const closest = lower[0];
    if (closest) {
      return closest.url;
    }
  }

  // Return highest quality
  return qualities[0]?.url ?? masterUrl;
}

/**
 * Downloads an HLS stream using ffmpeg.
 * @param hlsUrl The HLS playlist URL (master or media)
 * @param outputPath The output file path (should end in .mp4)
 * @param onProgress Progress callback
 * @param cookies Optional cookies for authenticated requests
 * @param referer Optional referer URL
 */
export async function downloadHLSVideo(
  hlsUrl: string,
  outputPath: string,
  onProgress?: (progress: DownloadProgress) => void,
  cookies?: string,
  referer?: string,
  authToken?: string
): Promise<HLSDownloadResult> {
  // Check if ffmpeg is available
  const hasFfmpeg = await checkFfmpeg();
  if (!hasFfmpeg) {
    return {
      success: false,
      error: "ffmpeg is not installed. Please install ffmpeg to download HLS videos.",
      errorCode: "FFMPEG_NOT_FOUND",
    };
  }

  // Handle special "segments:" URLs (for encrypted HLS with individual tokens)
  if (hlsUrl.startsWith("segments:")) {
    return downloadHLSSegments(hlsUrl, outputPath, onProgress);
  }

  // Pre-validate the HLS URL before downloading
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
        errorCode: "HLS_FETCH_FAILED",
      };
    }
  } catch (error) {
    return {
      success: false,
      error: `Failed to validate HLS URL: ${error instanceof Error ? error.message : String(error)}`,
      errorCode: "HLS_VALIDATION_FAILED",
    };
  }

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Use provided referer or extract origin from URL
  const urlObj = new URL(hlsUrl);
  const origin = referer ?? `${urlObj.protocol}//${urlObj.host}/`;
  const originHost = new URL(origin).origin;

  // Build ffmpeg command
  const args = [
    "-y", // Overwrite output
    "-hide_banner",
    "-loglevel",
    "warning",
    "-stats",
  ];

  // Add headers for authenticated requests
  const headerParts: string[] = [`Origin: ${originHost}`, `Referer: ${origin}`];
  if (cookies) {
    headerParts.push(`Cookie: ${cookies}`);
  }
  if (authToken) {
    headerParts.push(`APIKEY: ${authToken}`);
    headerParts.push(`Authorization: Bearer ${authToken}`);
  }
  args.push("-headers", headerParts.join("\r\n") + "\r\n");

  args.push(
    "-nostdin", // Prevent ffmpeg from waiting for input
    "-i",
    hlsUrl,
    "-c",
    "copy", // Copy streams without re-encoding
    "-bsf:a",
    "aac_adtstoasc", // Fix AAC stream
    outputPath
  );

  let duration = 0;
  let currentTime = 0;
  let lastProgressUpdate = 0;

  const updateProgress = () => {
    if (duration > 0 && onProgress) {
      const percent = Math.min((currentTime / duration) * 100, 100);
      const now = Date.now();

      // Throttle progress updates to avoid spam
      if (now - lastProgressUpdate > 200 || percent >= 100) {
        lastProgressUpdate = now;
        onProgress({
          phase: "downloading",
          percent: Math.round(percent),
          currentBytes: currentTime,
          totalBytes: duration,
        });
      }
    }
  };

  try {
    const subprocess = execa("ffmpeg", args);

    // Parse stderr for progress info
    subprocess.stderr?.on("data", (data: Buffer) => {
      const output = data.toString();

      // Parse duration from input info
      const durationMatch = /Duration:\s*(\d{2}):(\d{2}):(\d{2})\.(\d{2})/.exec(output);
      if (durationMatch && duration === 0) {
        const [, hours = "0", mins = "0", secs = "0", centis = "0"] = durationMatch;
        duration =
          parseInt(hours, 10) * 3600 +
          parseInt(mins, 10) * 60 +
          parseInt(secs, 10) +
          parseInt(centis, 10) / 100;
      }

      // Parse current time from progress
      const timeMatch = /time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/.exec(output);
      if (timeMatch) {
        const [, hours = "0", mins = "0", secs = "0", centis = "0"] = timeMatch;
        currentTime =
          parseInt(hours, 10) * 3600 +
          parseInt(mins, 10) * 60 +
          parseInt(secs, 10) +
          parseInt(centis, 10) / 100;

        updateProgress();
      }
    });

    await subprocess;

    // Final progress update
    if (onProgress) {
      onProgress({
        phase: "complete",
        percent: 100,
      });
    }

    return {
      success: true,
      outputPath,
      duration,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `ffmpeg error: ${errorMessage}`,
      errorCode: "FFMPEG_ERROR",
    };
  }
}

/**
 * Downloads a HighLevel HLS video with quality selection.
 * @param masterUrl The master playlist URL (may include token)
 * @param outputPath The output file path
 * @param preferredQuality Preferred quality label (e.g., "720p", "1080p")
 * @param onProgress Progress callback
 * @param cookies Optional cookies for authenticated requests
 * @param referer Optional referer URL
 */
export async function downloadHighLevelVideo(
  masterUrl: string,
  outputPath: string,
  preferredQuality?: string,
  onProgress?: (progress: DownloadProgress) => void,
  cookies?: string,
  referer?: string,
  authToken?: string
): Promise<HLSDownloadResult> {
  // Report start
  onProgress?.({
    phase: "preparing",
    percent: 0,
  });

  // Parse preferred height from quality string
  let preferredHeight: number | undefined;
  if (preferredQuality) {
    const match = /(\d+)p?/i.exec(preferredQuality);
    if (match?.[1]) {
      preferredHeight = parseInt(match[1], 10);
    }
  }

  // Get the best quality URL
  let downloadUrl = masterUrl;
  try {
    downloadUrl = await getBestQualityUrl(masterUrl, preferredHeight, cookies, referer, authToken);
  } catch (error) {
    console.warn("Failed to fetch quality options, using master URL:", error);
  }

  // Download using ffmpeg
  return downloadHLSVideo(downloadUrl, outputPath, onProgress, cookies, referer, authToken);
}
/* v8 ignore stop */

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

    // Pattern: /hls/v2/memberships/{locationId}/videos/{videoId}/...
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

/**
 * Downloads HLS video from individual segment URLs (for encrypted HLS with per-segment tokens)
 */
async function downloadHLSSegments(
  segmentsUrl: string,
  outputPath: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<HLSDownloadResult> {
  try {
    // Decode segment URLs from base64-encoded JSON
    const base64Data = segmentsUrl.replace("segments:", "");
    const segmentData = Buffer.from(base64Data, "base64").toString("utf-8");
    const segmentUrls: string[] = JSON.parse(segmentData) as string[];

    if (segmentUrls.length === 0) {
      return {
        success: false,
        error: "No segment URLs provided",
        errorCode: "NO_SEGMENTS",
      };
    }

    // Create temp directory for segments
    const tempDir = path.join(path.dirname(outputPath), ".hls-segments");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Download all segments
    const segmentPaths: string[] = [];
    for (let i = 0; i < segmentUrls.length; i++) {
      const segmentUrl = segmentUrls[i];
      if (!segmentUrl) continue;

      const segmentPath = path.join(tempDir, `segment${String(i).padStart(4, "0")}.ts`);
      segmentPaths.push(segmentPath);

      // Skip if already downloaded
      if (fs.existsSync(segmentPath)) {
        continue;
      }

      const response = await fetch(segmentUrl);
      if (!response.ok) {
        return {
          success: false,
          error: `Failed to download segment ${i}: HTTP ${response.status}`,
          errorCode: "SEGMENT_FETCH_FAILED",
        };
      }

      const buffer = await response.arrayBuffer();
      fs.writeFileSync(segmentPath, Buffer.from(buffer));

      // Report progress
      if (onProgress) {
        onProgress({
          percent: Math.round(((i + 1) / segmentUrls.length) * 90), // Leave 10% for merging
          phase: "downloading",
        });
      }
    }

    // Create concat file for ffmpeg
    const concatPath = path.join(tempDir, "concat.txt");
    const concatContent = segmentPaths.map((p) => `file '${p}'`).join("\n");
    fs.writeFileSync(concatPath, concatContent);

    // Merge segments with ffmpeg
    if (onProgress) {
      onProgress({ percent: 95, phase: "preparing" });
    }

    await execa("ffmpeg", [
      "-y",
      "-nostdin", // Prevent ffmpeg from waiting for input
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatPath,
      "-c",
      "copy",
      outputPath,
    ]);

    // Clean up temp files
    for (const p of segmentPaths) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
    try {
      fs.unlinkSync(concatPath);
    } catch {
      /* ignore */
    }
    try {
      fs.rmdirSync(tempDir);
    } catch {
      /* ignore */
    }

    if (onProgress) {
      onProgress({ percent: 100, phase: "complete" });
    }

    return {
      success: true,
      outputPath,
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return {
      success: false,
      error: `Segment download failed: ${error}`,
      errorCode: "SEGMENT_DOWNLOAD_FAILED",
    };
  }
}
