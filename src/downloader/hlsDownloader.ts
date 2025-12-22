import { exec, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import type { DownloadProgress } from "./loomDownloader.js";

const execAsync = promisify(exec);

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
export async function checkFfmpeg(): Promise<boolean> {
  try {
    await execAsync("ffmpeg -version");
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetches an HLS master playlist and parses quality variants.
 */
export async function fetchHLSQualities(masterUrl: string): Promise<HLSQuality[]> {
  try {
    const response = await fetch(masterUrl);
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
 */
export function parseHLSPlaylist(content: string, baseUrl: string): HLSQuality[] {
  const variants: HLSQuality[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();

    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      const bandwidthMatch = /BANDWIDTH=(\d+)/.exec(line);
      const resolutionMatch = /RESOLUTION=(\d+)x(\d+)/.exec(line);

      const bandwidth = bandwidthMatch ? parseInt(bandwidthMatch[1]!, 10) : 0;
      const width = resolutionMatch ? parseInt(resolutionMatch[1]!, 10) : undefined;
      const height = resolutionMatch ? parseInt(resolutionMatch[2]!, 10) : undefined;

      // Next line should be the URL
      const nextLine = lines[i + 1]?.trim() ?? "";
      if (nextLine && !nextLine.startsWith("#")) {
        const variantUrl = nextLine.startsWith("http") ? nextLine : new URL(nextLine, baseUrl).href;

        const label = height ? `${height}p` : `${Math.round(bandwidth / 1000)}k`;

        variants.push({
          label,
          url: variantUrl,
          bandwidth,
          width,
          height,
        });
      }
    }
  }

  // Sort by bandwidth (highest first)
  variants.sort((a, b) => b.bandwidth - a.bandwidth);

  return variants;
}

/**
 * Gets the best quality URL from a master playlist.
 * @param masterUrl The master playlist URL
 * @param preferredHeight Preferred video height (e.g., 720, 1080)
 */
export async function getBestQualityUrl(
  masterUrl: string,
  preferredHeight?: number
): Promise<string> {
  const qualities = await fetchHLSQualities(masterUrl);

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
    if (lower.length > 0) {
      return lower[0]!.url;
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
 */
export async function downloadHLSVideo(
  hlsUrl: string,
  outputPath: string,
  onProgress?: (progress: DownloadProgress) => void
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

  // Build ffmpeg command
  const args = [
    "-y", // Overwrite output
    "-hide_banner",
    "-loglevel",
    "warning",
    "-stats",
    "-i",
    hlsUrl,
    "-c",
    "copy", // Copy streams without re-encoding
    "-bsf:a",
    "aac_adtstoasc", // Fix AAC stream
    outputPath,
  ];

  return new Promise((resolve) => {
    const ffmpeg = spawn("ffmpeg", args);

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

    ffmpeg.stderr.on("data", (data: Buffer) => {
      const output = data.toString();

      // Parse duration from input info
      const durationMatch = /Duration:\s*(\d{2}):(\d{2}):(\d{2})\.(\d{2})/.exec(output);
      if (durationMatch && duration === 0) {
        duration =
          parseInt(durationMatch[1]!, 10) * 3600 +
          parseInt(durationMatch[2]!, 10) * 60 +
          parseInt(durationMatch[3]!, 10) +
          parseInt(durationMatch[4]!, 10) / 100;
      }

      // Parse current time from progress
      const timeMatch = /time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/.exec(output);
      if (timeMatch) {
        currentTime =
          parseInt(timeMatch[1]!, 10) * 3600 +
          parseInt(timeMatch[2]!, 10) * 60 +
          parseInt(timeMatch[3]!, 10) +
          parseInt(timeMatch[4]!, 10) / 100;

        updateProgress();
      }
    });

    ffmpeg.on("error", (error) => {
      resolve({
        success: false,
        error: `ffmpeg error: ${error.message}`,
        errorCode: "FFMPEG_ERROR",
      });
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        // Final progress update
        if (onProgress) {
          onProgress({
            phase: "complete",
            percent: 100,
          });
        }

        resolve({
          success: true,
          outputPath,
          duration,
        });
      } else {
        resolve({
          success: false,
          error: `ffmpeg exited with code ${code}`,
          errorCode: "FFMPEG_EXIT_ERROR",
        });
      }
    });
  });
}

/**
 * Downloads a HighLevel HLS video with quality selection.
 * @param masterUrl The master playlist URL (may include token)
 * @param outputPath The output file path
 * @param preferredQuality Preferred quality label (e.g., "720p", "1080p")
 * @param onProgress Progress callback
 */
export async function downloadHighLevelVideo(
  masterUrl: string,
  outputPath: string,
  preferredQuality?: string,
  onProgress?: (progress: DownloadProgress) => void
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
    if (match) {
      preferredHeight = parseInt(match[1]!, 10);
    }
  }

  // Get the best quality URL
  let downloadUrl = masterUrl;
  try {
    downloadUrl = await getBestQualityUrl(masterUrl, preferredHeight);
  } catch (error) {
    console.warn("Failed to fetch quality options, using master URL:", error);
  }

  // Download using ffmpeg
  return downloadHLSVideo(downloadUrl, outputPath, onProgress);
}

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

    if (!match) {
      return null;
    }

    const token = urlObj.searchParams.get("token");

    return {
      locationId: match[1]!,
      videoId: match[2]!,
      ...(token ? { token } : {}),
    };
  } catch {
    return null;
  }
}
