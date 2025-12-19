import { createWriteStream, existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { spawn } from "node:child_process";

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
  errorCode?: "EMBED_FETCH_FAILED" | "HLS_NOT_FOUND" | "RATE_LIMITED" | "NETWORK_ERROR" | "PARSE_ERROR";
  statusCode?: number;
  details?: string;
}

export interface DownloadProgress {
  percent: number;
  downloaded: number;
  total: number;
}

/**
 * Extracts the Loom video ID from various URL formats.
 */
export function extractLoomId(url: string): string | null {
  const match = url.match(/loom\.com\/(?:embed|share)\/([a-f0-9]+)/);
  return match?.[1] ?? null;
}

/**
 * Fetches video information from Loom's embed page with detailed error reporting.
 */
export async function getLoomVideoInfoDetailed(
  videoId: string,
  retryCount = 3,
  retryDelayMs = 1000
): Promise<LoomFetchResult> {
  const embedUrl = `https://www.loom.com/embed/${videoId}`;

  for (let attempt = 1; attempt <= retryCount; attempt++) {
    try {
      const embedResponse = await fetch(embedUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
          "Cache-Control": "no-cache",
        },
      });

      // Check for rate limiting
      if (embedResponse.status === 429) {
        const retryAfter = embedResponse.headers.get("Retry-After");
        const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : retryDelayMs * attempt * 2;

        if (attempt < retryCount) {
          await sleep(waitTime);
          continue;
        }

        return {
          success: false,
          error: `Rate limited by Loom (429)`,
          errorCode: "RATE_LIMITED",
          statusCode: 429,
          details: `Retry-After: ${retryAfter ?? "not specified"}. Tried ${retryCount} times.`,
        };
      }

      if (!embedResponse.ok) {
        // For 4xx errors, don't retry
        if (embedResponse.status >= 400 && embedResponse.status < 500 && embedResponse.status !== 429) {
          return {
            success: false,
            error: `Loom returned HTTP ${embedResponse.status}`,
            errorCode: "EMBED_FETCH_FAILED",
            statusCode: embedResponse.status,
            details: `URL: ${embedUrl}`,
          };
        }

        // For 5xx errors, retry
        if (attempt < retryCount) {
          await sleep(retryDelayMs * attempt);
          continue;
        }

        return {
          success: false,
          error: `Loom embed request failed with HTTP ${embedResponse.status}`,
          errorCode: "EMBED_FETCH_FAILED",
          statusCode: embedResponse.status,
          details: `URL: ${embedUrl}. Tried ${retryCount} times.`,
        };
      }

      const embedHtml = await embedResponse.text();

      // Check for various error states in the HTML
      if (embedHtml.includes("This video is private") || embedHtml.includes("video-not-found")) {
        return {
          success: false,
          error: "Video is private or not found",
          errorCode: "EMBED_FETCH_FAILED",
          statusCode: 200,
          details: "Loom returned a private/not-found page",
        };
      }

      if (embedHtml.includes("rate limit") || embedHtml.includes("too many requests")) {
        if (attempt < retryCount) {
          await sleep(retryDelayMs * attempt * 2);
          continue;
        }

        return {
          success: false,
          error: "Rate limited by Loom (detected in HTML)",
          errorCode: "RATE_LIMITED",
          statusCode: 200,
          details: "Rate limit message found in page content",
        };
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
        // Try to extract useful debug info from the HTML
        const hasVideoTag = embedHtml.includes("<video");
        const hasLoomPlayer = embedHtml.includes("loom-player") || embedHtml.includes("LoomPlayer");
        const hasEmbedData = embedHtml.includes("__NEXT_DATA__") || embedHtml.includes("window.__LOOM__");
        const pageLength = embedHtml.length;

        return {
          success: false,
          error: "Could not find HLS stream URL in embed page",
          errorCode: "HLS_NOT_FOUND",
          statusCode: 200,
          details: `Page size: ${pageLength} bytes, Has video tag: ${hasVideoTag}, Has Loom player: ${hasLoomPlayer}, Has embed data: ${hasEmbedData}`,
        };
      }

      // Get metadata from OEmbed (non-critical, don't fail if this doesn't work)
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

      return {
        success: true,
        info: { id: videoId, title, duration, width, height, hlsUrl },
      };

    } catch (error) {
      if (attempt < retryCount) {
        await sleep(retryDelayMs * attempt);
        continue;
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

  // Should never reach here, but TypeScript needs it
  return {
    success: false,
    error: "Unexpected error in fetch loop",
    errorCode: "NETWORK_ERROR",
  };
}

/**
 * Fetches video information from Loom's embed page.
 * @deprecated Use getLoomVideoInfoDetailed for better error reporting
 */
export async function getLoomVideoInfo(videoId: string): Promise<LoomVideoInfo | null> {
  const result = await getLoomVideoInfoDetailed(videoId);
  return result.success ? result.info ?? null : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
        const uriMatch = line.match(/URI="([^"]+)"/);
        if (uriMatch?.[1]) {
          const uri = uriMatch[1];
          // Append query params for authentication
          audioUrl = (uri.startsWith("http") ? uri : baseUrl + uri) + queryParams;
        }
      }

      // Find best quality video stream
      if (line.startsWith("#EXT-X-STREAM-INF:")) {
        const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
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
      console.error(`Failed to fetch playlist: ${response.status} - ${playlistUrl.substring(0, 100)}...`);
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
      if (trimmed && !trimmed.startsWith("#") && (trimmed.endsWith(".ts") || trimmed.includes(".ts?"))) {
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
      fileStream.end((err: Error | null) => (err ? reject(err) : resolve()));
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
  return new Promise((resolve) => {
    const proc = spawn("ffmpeg", ["-version"], { shell: true });
    proc.on("close", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}

/**
 * Merges video and audio files using ffmpeg.
 */
async function mergeWithFfmpeg(
  videoPath: string,
  audioPath: string,
  outputPath: string
): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(
      "ffmpeg",
      [
        "-i", videoPath,
        "-i", audioPath,
        "-c:v", "copy",
        "-c:a", "aac",
        "-y",
        outputPath,
      ],
      { shell: true, stdio: "ignore" }
    );

    proc.on("close", (code) => {
      // Clean up temp files
      if (existsSync(videoPath)) unlinkSync(videoPath);
      if (existsSync(audioPath)) unlinkSync(audioPath);
      resolve(code === 0);
    });

    proc.on("error", () => {
      resolve(false);
    });
  });
}

export interface LoomDownloadResult {
  success: boolean;
  error?: string;
  errorCode?: LoomFetchResult["errorCode"] | "INVALID_URL" | "NO_VIDEO_STREAM" | "NO_SEGMENTS" | "DOWNLOAD_FAILED" | "MERGE_FAILED";
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
    await sleep(200 + Math.random() * 600);

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

      const videoSuccess = await downloadSegmentsToFile(videoSegments, tempVideoPath, (curr, _total) => {
        completed = curr;
        if (onProgress) {
          onProgress({ percent: (completed / totalSegments) * 100, downloaded: completed, total: totalSegments });
        }
      });

      if (!videoSuccess) {
        return {
          success: false,
          error: "Failed to download video segments",
          errorCode: "DOWNLOAD_FAILED",
          details: `Video had ${videoSegments.length} segments`,
        };
      }

      // Download audio segments
      const audioSuccess = await downloadSegmentsToFile(audioSegments, tempAudioPath, (curr, _total) => {
        completed = videoSegments.length + curr;
        if (onProgress) {
          onProgress({ percent: (completed / totalSegments) * 100, downloaded: completed, total: totalSegments });
        }
      });

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
