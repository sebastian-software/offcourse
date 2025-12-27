/**
 * HLS (HTTP Live Streaming) download utilities.
 * Provides unified segment-based downloading for all video providers.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as HLS from "hls-parser";
import { USER_AGENT } from "../../shared/http.js";
import { getBaseUrl, extractQueryParams } from "../../shared/url.js";
import type { DownloadResult, HLSQuality, ProgressCallback, RequestHeaders } from "./types.js";
import { checkFfmpeg, concatSegments } from "./ffmpeg.js";

// ============================================================================
// HLS Playlist Parsing
// ============================================================================

/**
 * Parses an HLS master playlist to extract quality variants.
 * Uses hls-parser for robust parsing.
 */
export function parseHLSPlaylist(content: string, baseUrl: string): HLSQuality[] {
  try {
    const playlist = HLS.parse(content);

    if (!("variants" in playlist) || !playlist.variants) {
      return [];
    }

    const variants: HLSQuality[] = playlist.variants.map((variant) => {
      const bandwidth = variant.bandwidth ?? 0;
      const resolution = variant.resolution;
      const width = resolution?.width;
      const height = resolution?.height;

      const variantUrl = variant.uri.startsWith("http")
        ? variant.uri
        : new URL(variant.uri, baseUrl).href;

      const label = height ? `${height}p` : `${Math.round(bandwidth / 1000)}k`;

      return { label, url: variantUrl, bandwidth, width, height };
    });

    // Sort by bandwidth (highest first)
    variants.sort((a, b) => b.bandwidth - a.bandwidth);

    return variants;
  } catch {
    return [];
  }
}

/**
 * Parses an HLS master playlist to get video and audio playlist URLs.
 * Supports signed URLs with query parameters.
 */
/* v8 ignore start */
export async function parseHlsMasterPlaylist(
  masterUrl: string,
  headers?: RequestHeaders
): Promise<{ videoUrl: string | null; audioUrl: string | null }> {
  try {
    const response = await fetch(masterUrl, {
      headers: { "User-Agent": USER_AGENT, ...headers } as HeadersInit,
    });

    if (!response.ok) {
      return { videoUrl: null, audioUrl: null };
    }

    const playlist = await response.text();
    const lines = playlist.split("\n");

    const baseUrl = getBaseUrl(masterUrl);
    const queryParams = extractQueryParams(masterUrl);

    let videoUrl: string | null = null;
    let audioUrl: string | null = null;
    let bestBandwidth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]?.trim();
      if (!line) continue;

      // Find audio stream
      if (line.startsWith("#EXT-X-MEDIA:") && line.includes("TYPE=AUDIO")) {
        const uriMatch = /URI="([^"]+)"/.exec(line);
        if (uriMatch?.[1]) {
          const uri = uriMatch[1];
          audioUrl = (uri.startsWith("http") ? uri : baseUrl + uri) + queryParams;
        }
      }

      // Find best quality video stream
      if (line.startsWith("#EXT-X-STREAM-INF:")) {
        const bandwidthMatch = /BANDWIDTH=(\d+)/.exec(line);
        const bandwidth = bandwidthMatch?.[1] ? parseInt(bandwidthMatch[1], 10) : 0;

        const nextLine = lines[i + 1]?.trim();
        if (nextLine && !nextLine.startsWith("#") && bandwidth > bestBandwidth) {
          bestBandwidth = bandwidth;
          videoUrl = (nextLine.startsWith("http") ? nextLine : baseUrl + nextLine) + queryParams;
        }
      }
    }

    return { videoUrl, audioUrl };
  } catch (error) {
    console.error("Failed to parse master playlist:", error);
    return { videoUrl: null, audioUrl: null };
  }
}

/**
 * Gets all segment URLs from a media playlist.
 */
export async function getSegmentUrls(
  playlistUrl: string,
  headers?: RequestHeaders
): Promise<string[]> {
  try {
    const response = await fetch(playlistUrl, {
      headers: { "User-Agent": USER_AGENT, ...headers } as HeadersInit,
    });

    if (!response.ok) {
      console.error(
        `Failed to fetch playlist: ${response.status} - ${playlistUrl.substring(0, 100)}...`
      );
      return [];
    }

    const playlist = await response.text();
    const lines = playlist.split("\n");

    const baseUrl = getBaseUrl(playlistUrl);
    const queryParams = extractQueryParams(playlistUrl);

    const segments: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (
        trimmed &&
        !trimmed.startsWith("#") &&
        (trimmed.endsWith(".ts") || trimmed.includes(".ts?"))
      ) {
        const segmentUrl = trimmed.startsWith("http") ? trimmed : baseUrl + trimmed;
        const fullUrl = segmentUrl.includes("?") ? segmentUrl : segmentUrl + queryParams;
        segments.push(fullUrl);
      }
    }

    return segments;
  } catch (error) {
    console.error("Failed to get segments:", error);
    return [];
  }
}
/* v8 ignore stop */

// ============================================================================
// Segment Download
// ============================================================================

/**
 * Downloads HLS segments and writes them to a file.
 * Used when ffmpeg is not available or not needed.
 */
/* v8 ignore start */
export async function downloadSegmentsToFile(
  segments: string[],
  outputPath: string,
  options: {
    onProgress?: ((current: number, total: number) => void) | undefined;
    headers?: RequestHeaders | undefined;
  } = {}
): Promise<boolean> {
  const { onProgress, headers } = options;
  const tempPath = `${outputPath}.tmp`;
  const fileStream = fs.createWriteStream(tempPath);

  try {
    for (let i = 0; i < segments.length; i++) {
      const segmentUrl = segments[i];
      if (!segmentUrl) continue;

      const response = await fetch(segmentUrl, {
        headers: { "User-Agent": USER_AGENT, ...headers } as HeadersInit,
      });

      if (!response.ok || !response.body) continue;

      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fileStream.write(Buffer.from(value));
      }

      onProgress?.(i + 1, segments.length);
    }

    await new Promise<void>((resolve, reject) => {
      fileStream.end((err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });

    fs.renameSync(tempPath, outputPath);
    return true;
  } catch {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    return false;
  }
}

/**
 * Downloads HLS segments individually to temp files, then merges with ffmpeg.
 * Used for encrypted HLS or when better compatibility is needed.
 */
export async function downloadSegmentsWithMerge(
  segmentUrls: string[],
  outputPath: string,
  options: {
    onProgress?: ProgressCallback | undefined;
    headers?: RequestHeaders | undefined;
  } = {}
): Promise<DownloadResult> {
  const { onProgress, headers } = options;

  if (segmentUrls.length === 0) {
    return {
      success: false,
      error: "No segment URLs provided",
      errorCode: "NO_SEGMENTS",
    };
  }

  // Check ffmpeg availability
  const hasFfmpeg = await checkFfmpeg();
  if (!hasFfmpeg) {
    return {
      success: false,
      error: "ffmpeg is not installed. Please install ffmpeg to download HLS videos.",
      errorCode: "FFMPEG_NOT_FOUND",
    };
  }

  // Create unique temp directory
  const videoBaseName = path.basename(outputPath, path.extname(outputPath));
  const uniqueId = `${videoBaseName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tempDir = path.join(path.dirname(outputPath), `.hls-segments-${uniqueId}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const cleanupTempDir = () => {
    try {
      if (fs.existsSync(tempDir)) {
        const files = fs.readdirSync(tempDir);
        for (const file of files) {
          try {
            fs.unlinkSync(path.join(tempDir, file));
          } catch {
            /* ignore */
          }
        }
        fs.rmdirSync(tempDir);
      }
    } catch {
      /* ignore cleanup errors */
    }
  };

  try {
    const segmentPaths: string[] = [];

    // Download all segments
    for (let i = 0; i < segmentUrls.length; i++) {
      const segmentUrl = segmentUrls[i];
      if (!segmentUrl) continue;

      const segmentPath = path.join(tempDir, `segment${String(i).padStart(4, "0")}.ts`);
      segmentPaths.push(segmentPath);

      const response = await fetch(segmentUrl, {
        headers: { "User-Agent": USER_AGENT, ...headers } as HeadersInit,
      });

      if (!response.ok) {
        cleanupTempDir();
        return {
          success: false,
          error: `Failed to download segment ${i}: HTTP ${response.status}`,
          errorCode: "SEGMENT_FETCH_FAILED",
        };
      }

      const buffer = await response.arrayBuffer();
      fs.writeFileSync(segmentPath, Buffer.from(buffer));

      onProgress?.({
        percent: Math.round(((i + 1) / segmentUrls.length) * 90),
        phase: "downloading",
        downloadedSegments: i + 1,
        totalSegments: segmentUrls.length,
      });
    }

    // Merge segments with ffmpeg
    onProgress?.({ percent: 95, phase: "merging" });

    const mergeSuccess = await concatSegments(segmentPaths, outputPath, tempDir);

    cleanupTempDir();

    if (!mergeSuccess) {
      return {
        success: false,
        error: "Failed to merge segments with ffmpeg",
        errorCode: "MERGE_FAILED",
      };
    }

    onProgress?.({ percent: 100, phase: "complete" });

    return { success: true, outputPath };
  } catch (e) {
    cleanupTempDir();
    const error = e instanceof Error ? e.message : String(e);
    return {
      success: false,
      error: `Segment download failed: ${error}`,
      errorCode: "DOWNLOAD_FAILED",
    };
  }
}
/* v8 ignore stop */

// ============================================================================
// Segments URL Encoding
// ============================================================================

/**
 * The prefix for segment-based download URLs.
 * These URLs contain base64-encoded JSON arrays of individual segment URLs.
 */
export const SEGMENTS_URL_PREFIX = "segments:";

/**
 * Checks if a URL is a segments URL (for encrypted HLS segment downloads).
 */
export function isSegmentsUrl(url: string): boolean {
  return url.startsWith(SEGMENTS_URL_PREFIX);
}

/**
 * Parses a segments URL and returns the array of segment URLs.
 * @param segmentsUrl A URL in format `segments:base64encodedJSON`
 * @returns Array of segment URLs or null if invalid
 */
export function parseSegmentsUrl(segmentsUrl: string): string[] | null {
  if (!isSegmentsUrl(segmentsUrl)) {
    return null;
  }

  try {
    const base64Data = segmentsUrl.slice(SEGMENTS_URL_PREFIX.length);
    const jsonString = Buffer.from(base64Data, "base64").toString("utf-8");
    const parsed: unknown = JSON.parse(jsonString);

    if (!Array.isArray(parsed)) {
      return null;
    }

    if (!parsed.every((item): item is string => typeof item === "string")) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Creates a segments URL from an array of segment URLs.
 * This is the inverse of parseSegmentsUrl.
 */
export function createSegmentsUrl(segmentUrls: string[]): string {
  const jsonString = JSON.stringify(segmentUrls);
  const base64Data = Buffer.from(jsonString).toString("base64");
  return `${SEGMENTS_URL_PREFIX}${base64Data}`;
}
