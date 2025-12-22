import { createWriteStream, existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import delay from "delay";
import { execa } from "execa";
import pRetry, { AbortError } from "p-retry";

export interface LoomVideoInfo {
  id: string;
  title: string;
  duration: number;
  width: number;
  height: number;
  hlsUrl: string;
}

export interface LoomFetchResult {
  success: boolean;
  info?: LoomVideoInfo;
  error?: string;
  errorCode?:
    | "EMBED_FETCH_FAILED"
    | "HLS_NOT_FOUND"
    | "RATE_LIMITED"
    | "NETWORK_ERROR"
    | "PARSE_ERROR";
  statusCode?: number;
  details?: string;
}

export interface DownloadProgress {
  percent: number;
  downloaded?: number | undefined;
  total?: number | undefined;
  phase?: "preparing" | "downloading" | "complete" | undefined;
  currentBytes?: number | undefined;
  totalBytes?: number | undefined;
}

/**
 * Extracts the Loom video ID from various URL formats.
 */
export function extractLoomId(url: string): string | null {
  const match = /loom\.com\/(?:embed|share)\/([a-f0-9]+)/.exec(url);
  return match?.[1] ?? null;
}

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
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      "Cache-Control": "no-cache",
    },
  });

  // Check for rate limiting - should retry
  if (embedResponse.status === 429) {
    throw new Error("Rate limited by Loom (429)");
  }

  // For 4xx errors (except 429), don't retry
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

  // For 5xx errors, throw to trigger retry
  if (!embedResponse.ok) {
    throw new Error(`Loom embed request failed with HTTP ${embedResponse.status}`);
  }

  const embedHtml = await embedResponse.text();

  // Check for various error states in the HTML - don't retry these
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

  // Rate limit in HTML - should retry
  if (embedHtml.includes("rate limit") || embedHtml.includes("too many requests")) {
    throw new Error("Rate limited by Loom (detected in HTML)");
  }

  // Extract HLS URL from the page - try multiple patterns
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

  // Get metadata from OEmbed (non-critical)
  const oembedUrl = `https://www.loom.com/v1/oembed?url=https://www.loom.com/share/${videoId}`;
  let title = "Loom Video";
  let duration = 0;
  let width = 1920;
  let height = 1080;

  try {
    const oembedResponse = await fetch(oembedUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
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
        // Only log if not the last attempt
        if (error.retriesLeft > 0) {
          console.log(
            `Loom fetch attempt ${error.attemptNumber} failed, ${error.retriesLeft} retries left`
          );
        }
      },
    });

    return { success: true, info };
  } catch (error) {
    // Handle LoomFetchError directly
    if (error instanceof LoomFetchError) {
      return error.toResult();
    }

    // Handle wrapped AbortError (p-retry wraps errors)
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

/**
 * Fetches video information from Loom's embed page.
 * @deprecated Use getLoomVideoInfoDetailed for better error reporting
 */
export async function getLoomVideoInfo(videoId: string): Promise<LoomVideoInfo | null> {
  const result = await getLoomVideoInfoDetailed(videoId);
  return result.success ? (result.info ?? null) : null;
}

/**
 * Extracts query params from a URL for reuse.
 */
function extractQueryParams(url: string): string {
  const queryStart = url.indexOf("?");
  return queryStart !== -1 ? url.substring(queryStart) : "";
}

/**
 * Parses a master playlist to get video and audio playlist URLs.
 */
async function parseHlsMasterPlaylist(
  masterUrl: string
): Promise<{ videoUrl: string | null; audioUrl: string | null }> {
  try {
    const response = await fetch(masterUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    if (!response.ok) {
      return { videoUrl: null, audioUrl: null };
    }

    const playlist = await response.text();
    const lines = playlist.split("\n");

    // Get base URL and query params (for signed URLs)
    const baseUrl = masterUrl.substring(0, masterUrl.lastIndexOf("/") + 1);
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
          // Append query params for authentication
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
          // Append query params for authentication
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
async function getSegmentUrls(playlistUrl: string): Promise<string[]> {
  try {
    const response = await fetch(playlistUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    if (!response.ok) {
      console.error(
        `Failed to fetch playlist: ${response.status} - ${playlistUrl.substring(0, 100)}...`
      );
      return [];
    }

    const playlist = await response.text();
    const lines = playlist.split("\n");

    // Get base URL and query params
    const baseUrl = playlistUrl.substring(0, playlistUrl.lastIndexOf("/") + 1);
    const queryParams = extractQueryParams(playlistUrl);

    const segments: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (
        trimmed &&
        !trimmed.startsWith("#") &&
        (trimmed.endsWith(".ts") || trimmed.includes(".ts?"))
      ) {
        // Construct full URL with auth params
        const segmentUrl = trimmed.startsWith("http") ? trimmed : baseUrl + trimmed;
        // Add query params if segment URL doesn't have them
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

/**
 * Downloads segments and writes them to a file.
 */
async function downloadSegmentsToFile(
  segments: string[],
  outputPath: string,
  onProgress?: (current: number, total: number) => void
): Promise<boolean> {
  const tempPath = `${outputPath}.tmp`;
  const fileStream = createWriteStream(tempPath);

  try {
    for (let i = 0; i < segments.length; i++) {
      const segmentUrl = segments[i];
      if (!segmentUrl) continue;

      const response = await fetch(segmentUrl, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });

      if (!response.ok || !response.body) continue;

      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fileStream.write(Buffer.from(value));
      }

      if (onProgress) {
        onProgress(i + 1, segments.length);
      }
    }

    await new Promise<void>((resolve, reject) => {
      fileStream.end((err: Error | null) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

    renameSync(tempPath, outputPath);
    return true;
  } catch {
    if (existsSync(tempPath)) unlinkSync(tempPath);
    return false;
  }
}

/**
 * Checks if ffmpeg is available.
 */
async function isFfmpegAvailable(): Promise<boolean> {
  try {
    await execa("ffmpeg", ["-version"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Merges video and audio files using ffmpeg.
 */
async function mergeWithFfmpeg(
  videoPath: string,
  audioPath: string,
  outputPath: string
): Promise<boolean> {
  try {
    await execa(
      "ffmpeg",
      ["-i", videoPath, "-i", audioPath, "-c:v", "copy", "-c:a", "aac", "-y", outputPath],
      { stdio: "ignore" }
    );

    // Clean up temp files
    if (existsSync(videoPath)) unlinkSync(videoPath);
    if (existsSync(audioPath)) unlinkSync(audioPath);
    return true;
  } catch {
    // Clean up temp files on failure too
    if (existsSync(videoPath)) unlinkSync(videoPath);
    if (existsSync(audioPath)) unlinkSync(audioPath);
    return false;
  }
}

export interface LoomDownloadResult {
  success: boolean;
  error?: string;
  errorCode?:
    | LoomFetchResult["errorCode"]
    | "INVALID_URL"
    | "NO_VIDEO_STREAM"
    | "NO_SEGMENTS"
    | "DOWNLOAD_FAILED"
    | "MERGE_FAILED";
  details?: string;
}

/**
 * Downloads a Loom video using HLS.
 */
export async function downloadLoomVideo(
  urlOrId: string,
  outputPath: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<LoomDownloadResult> {
  if (existsSync(outputPath)) {
    return { success: true };
  }

  let hlsUrl: string;
  let videoUrl: string | null = null;
  let audioUrl: string | null = null;

  // Check if this is already a direct HLS URL (from previous validation)
  if (urlOrId.includes("luna.loom.com") && urlOrId.includes(".m3u8")) {
    hlsUrl = urlOrId;

    // Check if this is a media playlist (not master playlist)
    // Media playlists are named: mediaplaylist-video-bitrate*.m3u8 or mediaplaylist-audio.m3u8
    if (hlsUrl.includes("mediaplaylist-video-")) {
      // This is already a video media playlist - use it directly
      videoUrl = hlsUrl;
      // Try to get audio URL by replacing video playlist with audio playlist
      audioUrl = hlsUrl.replace(/mediaplaylist-video-bitrate\d+\.m3u8/, "mediaplaylist-audio.m3u8");
    } else if (hlsUrl.includes("mediaplaylist-audio")) {
      // This is an audio-only playlist - convert to master playlist
      hlsUrl = hlsUrl.replace(/mediaplaylist-audio\.m3u8/, "playlist.m3u8");
    }
    // Otherwise it's a master playlist (playlist.m3u8) - parse it below
  } else {
    // Extract video ID and fetch HLS URL from Loom API
    const videoId = urlOrId.includes("loom.com") ? extractLoomId(urlOrId) : urlOrId;
    if (!videoId) {
      return { success: false, error: "Invalid Loom URL or ID", errorCode: "INVALID_URL" };
    }

    // Add random delay to avoid concurrent rate limiting (200-800ms)
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

  // Parse master playlist if we don't already have video URL
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

  // Get segments
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

  // If there's audio, we need ffmpeg to merge
  if (audioUrl) {
    const hasFfmpeg = await isFfmpegAvailable();

    if (hasFfmpeg) {
      const audioSegments = await getSegmentUrls(audioUrl);
      const tempId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const tempVideoPath = join(dir, `.temp-video-${tempId}.ts`);
      const tempAudioPath = join(dir, `.temp-audio-${tempId}.ts`);

      // Download video segments
      const totalSegments = videoSegments.length + audioSegments.length;
      let completed = 0;

      const videoSuccess = await downloadSegmentsToFile(
        videoSegments,
        tempVideoPath,
        (curr, _total) => {
          completed = curr;
          if (onProgress) {
            onProgress({
              percent: (completed / totalSegments) * 100,
              downloaded: completed,
              total: totalSegments,
            });
          }
        }
      );

      if (!videoSuccess) {
        return {
          success: false,
          error: "Failed to download video segments",
          errorCode: "DOWNLOAD_FAILED",
          details: `Video had ${videoSegments.length} segments`,
        };
      }

      // Download audio segments
      const audioSuccess = await downloadSegmentsToFile(
        audioSegments,
        tempAudioPath,
        (curr, _total) => {
          completed = videoSegments.length + curr;
          if (onProgress) {
            onProgress({
              percent: (completed / totalSegments) * 100,
              downloaded: completed,
              total: totalSegments,
            });
          }
        }
      );

      if (!audioSuccess) {
        if (existsSync(tempVideoPath)) unlinkSync(tempVideoPath);
        return {
          success: false,
          error: "Failed to download audio segments",
          errorCode: "DOWNLOAD_FAILED",
          details: `Audio had ${audioSegments.length} segments`,
        };
      }

      // Merge with ffmpeg
      const mergeSuccess = await mergeWithFfmpeg(tempVideoPath, tempAudioPath, outputPath);
      if (!mergeSuccess) {
        return {
          success: false,
          error: "Failed to merge video and audio with ffmpeg",
          errorCode: "MERGE_FAILED",
        };
      }

      return { success: true };
    } else {
      // No ffmpeg - download video only with warning
      console.warn("⚠️  ffmpeg not found - downloading video without audio");
    }
  }

  // Download video only (no audio or no ffmpeg)
  const success = await downloadSegmentsToFile(videoSegments, outputPath, (curr, total) => {
    if (onProgress) {
      onProgress({ percent: (curr / total) * 100, downloaded: curr, total });
    }
  });

  if (!success) {
    return {
      success: false,
      error: "Failed to download video segments",
      errorCode: "DOWNLOAD_FAILED",
      details: `Video had ${videoSegments.length} segments`,
    };
  }

  return { success: true };
}

/**
 * Downloads a file directly.
 */
export async function downloadFile(
  url: string,
  outputPath: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<{ success: boolean; error?: string }> {
  if (existsSync(outputPath)) {
    return { success: true };
  }

  const dir = dirname(outputPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const tempPath = `${outputPath}.tmp`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: "https://www.loom.com/",
      },
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const contentLength = response.headers.get("content-length");
    const total = contentLength ? parseInt(contentLength, 10) : 0;

    if (!response.body) {
      return { success: false, error: "No response body" };
    }

    const fileStream = createWriteStream(tempPath);
    const reader = response.body.getReader();
    let downloaded = 0;

    const readable = new Readable({
      async read(): Promise<void> {
        const { done, value } = await reader.read();
        if (done) {
          this.push(null);
        } else {
          downloaded += value.length;
          if (onProgress && total > 0) {
            onProgress({ percent: (downloaded / total) * 100, downloaded, total });
          }
          this.push(Buffer.from(value));
        }
      },
    });

    await finished(readable.pipe(fileStream));
    renameSync(tempPath, outputPath);

    return { success: true };
  } catch (error) {
    if (existsSync(tempPath)) unlinkSync(tempPath);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
