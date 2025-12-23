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
  cookies?: string
): Promise<HLSQuality[]> {
  try {
    // Extract origin from URL for proper CORS headers
    const urlObj = new URL(masterUrl);
    const origin = `${urlObj.protocol}//${urlObj.host}`;

    const headers: Record<string, string> = {
      Origin: origin,
      Referer: origin + "/",
    };
    if (cookies) {
      headers.Cookie = cookies;
    }

    const response = await fetch(masterUrl, { headers });
    if (!response.ok) {
      throw new Error(`Failed to fetch playlist: ${response.status}`);
    }

    const content = await response.text();
    return parseHLSPlaylist(content, masterUrl);
  } catch (error) {
    console.error("Failed to fetch HLS qualities:", error);
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
 */
/* v8 ignore start */
export async function getBestQualityUrl(
  masterUrl: string,
  preferredHeight?: number,
  cookies?: string
): Promise<string> {
  const qualities = await fetchHLSQualities(masterUrl, cookies);

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
 */
export async function downloadHLSVideo(
  hlsUrl: string,
  outputPath: string,
  onProgress?: (progress: DownloadProgress) => void,
  cookies?: string
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

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Extract origin from URL for proper headers
  const urlObj = new URL(hlsUrl);
  const origin = `${urlObj.protocol}//${urlObj.host}`;

  // Build ffmpeg command
  const args = [
    "-y", // Overwrite output
    "-hide_banner",
    "-loglevel",
    "warning",
    "-stats",
  ];

  // Add headers for authenticated requests
  const headerParts: string[] = [`Origin: ${origin}`, `Referer: ${origin}/`];
  if (cookies) {
    headerParts.push(`Cookie: ${cookies}`);
  }
  args.push("-headers", headerParts.join("\r\n") + "\r\n");

  args.push(
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
 */
export async function downloadHighLevelVideo(
  masterUrl: string,
  outputPath: string,
  preferredQuality?: string,
  onProgress?: (progress: DownloadProgress) => void,
  cookies?: string
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
    downloadUrl = await getBestQualityUrl(masterUrl, preferredHeight, cookies);
  } catch (error) {
    console.warn("Failed to fetch quality options, using master URL:", error);
  }

  // Download using ffmpeg
  return downloadHLSVideo(downloadUrl, outputPath, onProgress, cookies);
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
