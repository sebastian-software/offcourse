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
 * Fetches video information from Loom's embed page.
 */
export async function getLoomVideoInfo(videoId: string): Promise<LoomVideoInfo | null> {
  try {
    const embedUrl = `https://www.loom.com/embed/${videoId}`;
    const embedResponse = await fetch(embedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });

    if (!embedResponse.ok) {
      return null;
    }

    const embedHtml = await embedResponse.text();

    // Extract HLS URL from the page
    const hlsMatch = embedHtml.match(/"url":"(https:\/\/luna\.loom\.com\/[^"]+playlist\.m3u8[^"]*)"/);

    if (!hlsMatch?.[1]) {
      return null;
    }

    const hlsUrl = hlsMatch[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/");

    // Get metadata from OEmbed
    const oembedUrl = `https://www.loom.com/v1/oembed?url=https://www.loom.com/share/${videoId}`;
    const oembedResponse = await fetch(oembedUrl);
    let title = "Loom Video";
    let duration = 0;
    let width = 1920;
    let height = 1080;

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

    return { id: videoId, title, duration, width, height, hlsUrl };
  } catch (error) {
    console.error("Failed to fetch Loom video info:", error);
    return null;
  }
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
  } catch (error) {
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

/**
 * Downloads a Loom video using HLS.
 */
export async function downloadLoomVideo(
  urlOrId: string,
  outputPath: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<{ success: boolean; error?: string }> {
  if (existsSync(outputPath)) {
    return { success: true };
  }

  const videoId = urlOrId.includes("loom.com") ? extractLoomId(urlOrId) : urlOrId;
  if (!videoId) {
    return { success: false, error: "Invalid Loom URL or ID" };
  }

  const info = await getLoomVideoInfo(videoId);
  if (!info) {
    return { success: false, error: "Could not fetch video info from Loom" };
  }

  // Parse master playlist
  const { videoUrl, audioUrl } = await parseHlsMasterPlaylist(info.hlsUrl);

  if (!videoUrl) {
    return { success: false, error: "Could not find video stream" };
  }

  // Get segments
  const videoSegments = await getSegmentUrls(videoUrl);
  if (videoSegments.length === 0) {
    return { success: false, error: "No video segments found" };
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
      const tempVideoPath = join(dir, `.temp-video-${videoId}.ts`);
      const tempAudioPath = join(dir, `.temp-audio-${videoId}.ts`);

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
        return { success: false, error: "Failed to download video segments" };
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
        return { success: false, error: "Failed to download audio segments" };
      }

      // Merge with ffmpeg
      const mergeSuccess = await mergeWithFfmpeg(tempVideoPath, tempAudioPath, outputPath);
      if (!mergeSuccess) {
        return { success: false, error: "Failed to merge video and audio" };
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
    return { success: false, error: "Failed to download video segments" };
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
      async read() {
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
