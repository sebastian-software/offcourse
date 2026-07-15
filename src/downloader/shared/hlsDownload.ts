/**
 * HLS (HTTP Live Streaming) download utilities.
 * Provides unified segment-based downloading for all video providers.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as HLS from "hls-parser";
import pRetry, { AbortError } from "p-retry";
import { USER_AGENT } from "../../shared/http.js";
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

function getHlsAttribute(line: string, name: string): string | null {
  const match = new RegExp(`(?:^|[:,])${name}=("[^"]*"|[^,]*)`).exec(line);
  return match?.[1]?.replace(/^"|"$/g, "") ?? null;
}

/**
 * Resolves a child HLS URI and inherits the parent query only when the child
 * does not carry its own signed query string.
 */
export function resolveHlsUri(uri: string, parentUrl: string): string {
  const resolved = new URL(uri, parentUrl);
  const parent = new URL(parentUrl);
  if (!resolved.search && parent.search) {
    resolved.search = parent.search;
  }
  return resolved.href;
}

/**
 * Parses the best video rendition and its associated audio rendition.
 */
export function parseHlsMasterPlaylistContent(
  playlist: string,
  masterUrl: string
): { videoUrl: string | null; audioUrl: string | null } {
  const lines = playlist.split("\n");
  const audioRenditions: { groupId: string | null; url: string; isDefault: boolean }[] = [];
  const variants: { bandwidth: number; audioGroup: string | null; url: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? "";
    if (!line) continue;

    if (line.startsWith("#EXT-X-MEDIA:") && getHlsAttribute(line, "TYPE") === "AUDIO") {
      const uri = getHlsAttribute(line, "URI");
      if (uri) {
        audioRenditions.push({
          groupId: getHlsAttribute(line, "GROUP-ID"),
          url: resolveHlsUri(uri, masterUrl),
          isDefault: getHlsAttribute(line, "DEFAULT") === "YES",
        });
      }
      continue;
    }

    if (!line.startsWith("#EXT-X-STREAM-INF:")) continue;

    let uri: string | null = null;
    for (let next = i + 1; next < lines.length; next++) {
      const candidate = lines[next]?.trim() ?? "";
      if (!candidate) continue;
      if (!candidate.startsWith("#")) uri = candidate;
      break;
    }

    if (!uri) continue;
    variants.push({
      bandwidth: parseInt(getHlsAttribute(line, "BANDWIDTH") ?? "0", 10),
      audioGroup: getHlsAttribute(line, "AUDIO"),
      url: resolveHlsUri(uri, masterUrl),
    });
  }

  const bestVariant = variants.sort((a, b) => b.bandwidth - a.bandwidth)[0];
  if (!bestVariant) return { videoUrl: null, audioUrl: null };

  const matchingAudio = bestVariant.audioGroup
    ? audioRenditions.filter((audio) => audio.groupId === bestVariant.audioGroup)
    : audioRenditions;
  const audio = matchingAudio.find((candidate) => candidate.isDefault) ?? matchingAudio[0];

  return {
    videoUrl: bestVariant.url,
    audioUrl: audio?.url ?? null,
  };
}

/**
 * Extracts transport-stream segment URLs from a media playlist.
 */
export function parseHlsMediaPlaylistContent(playlist: string, playlistUrl: string): string[] {
  return playlist
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 && !line.startsWith("#") && (line.endsWith(".ts") || line.includes(".ts?"))
    )
    .map((uri) => resolveHlsUri(uri, playlistUrl));
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

    return parseHlsMasterPlaylistContent(await response.text(), masterUrl);
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

    return parseHlsMediaPlaylistContent(await response.text(), playlistUrl);
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
  let fileHandle: fs.promises.FileHandle | undefined;

  try {
    fileHandle = await fs.promises.open(tempPath, "w");

    for (let i = 0; i < segments.length; i++) {
      const segmentUrl = segments[i];
      if (!segmentUrl) continue;

      const segment = await pRetry(
        async () => {
          const response = await fetch(segmentUrl, {
            headers: { "User-Agent": USER_AGENT, ...headers } as HeadersInit,
          });

          if (!response.ok) {
            const error = new Error(`Failed to download segment ${i}: HTTP ${response.status}`);
            const isPermanentClientError =
              response.status >= 400 &&
              response.status < 500 &&
              response.status !== 408 &&
              response.status !== 429;
            if (isPermanentClientError) throw new AbortError(error);
            throw error;
          }

          if (!response.body) {
            throw new AbortError(`Failed to download segment ${i}: empty response body`);
          }

          return Buffer.from(await response.arrayBuffer());
        },
        { retries: 2, minTimeout: 500, maxTimeout: 2000 }
      );

      await fileHandle.writeFile(segment);

      onProgress?.(i + 1, segments.length);
    }

    await fileHandle.close();
    fileHandle = undefined;

    fs.renameSync(tempPath, outputPath);
    return true;
  } catch {
    await fileHandle?.close().catch(() => undefined);
    await fs.promises.rm(tempPath, { force: true }).catch(() => undefined);
    return false;
  }
}

/**
 * Downloads HLS segments individually to temp files, then merges with ffmpeg.
 * Used for encrypted HLS or when better compatibility is needed.
 */
/* v8 ignore start */
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
