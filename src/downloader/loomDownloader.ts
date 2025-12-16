import { createWriteStream, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";

export interface LoomVideoInfo {
  id: string;
  title: string;
  duration: number;
  width: number;
  height: number;
  videoUrl: string;
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
  // https://www.loom.com/embed/abc123
  // https://www.loom.com/share/abc123
  // https://loom.com/embed/abc123
  const match = url.match(/loom\.com\/(?:embed|share)\/([a-f0-9]+)/);
  return match?.[1] ?? null;
}

/**
 * Fetches video information from Loom's API.
 */
export async function getLoomVideoInfo(videoId: string): Promise<LoomVideoInfo | null> {
  try {
    // Loom's public OEmbed endpoint
    const oembedUrl = `https://www.loom.com/v1/oembed?url=https://www.loom.com/share/${videoId}`;
    const response = await fetch(oembedUrl);

    if (!response.ok) {
      console.error(`Loom OEmbed failed: ${response.status}`);
      return null;
    }

    const data = (await response.json()) as {
      title?: string;
      duration?: number;
      width?: number;
      height?: number;
    };

    // Now fetch the actual video URL from the embed page
    const embedUrl = `https://www.loom.com/embed/${videoId}`;
    const embedResponse = await fetch(embedUrl);
    const embedHtml = await embedResponse.text();

    // Look for video URL in the page - Loom includes it in a JSON blob
    // Pattern: "url":"https://cdn.loom.com/sessions/..."
    const videoUrlMatch = embedHtml.match(/"url":"(https:\/\/cdn\.loom\.com\/sessions\/[^"]+\.mp4[^"]*)"/);

    if (!videoUrlMatch?.[1]) {
      // Try alternative pattern for transcoded videos
      const altMatch = embedHtml.match(/"transcoded_url":"(https:\/\/[^"]+\.mp4[^"]*)"/);
      if (!altMatch?.[1]) {
        console.error("Could not find video URL in Loom embed");
        return null;
      }
      return {
        id: videoId,
        title: data.title ?? "Untitled",
        duration: data.duration ?? 0,
        width: data.width ?? 1920,
        height: data.height ?? 1080,
        videoUrl: altMatch[1].replace(/\\u0026/g, "&"),
      };
    }

    return {
      id: videoId,
      title: data.title ?? "Untitled",
      duration: data.duration ?? 0,
      width: data.width ?? 1920,
      height: data.height ?? 1080,
      videoUrl: videoUrlMatch[1].replace(/\\u0026/g, "&"),
    };
  } catch (error) {
    console.error("Failed to fetch Loom video info:", error);
    return null;
  }
}

/**
 * Downloads a video file from a URL with progress tracking.
 */
export async function downloadFile(
  url: string,
  outputPath: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<{ success: boolean; error?: string }> {
  // Skip if already exists
  if (existsSync(outputPath)) {
    return { success: true };
  }

  // Ensure directory exists
  const dir = dirname(outputPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const tempPath = `${outputPath}.tmp`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Referer: "https://www.loom.com/",
      },
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
    }

    const contentLength = response.headers.get("content-length");
    const total = contentLength ? parseInt(contentLength, 10) : 0;

    if (!response.body) {
      return { success: false, error: "No response body" };
    }

    const fileStream = createWriteStream(tempPath);
    const reader = response.body.getReader();

    let downloaded = 0;

    // Create a readable stream from the response
    const readable = new Readable({
      async read() {
        const { done, value } = await reader.read();
        if (done) {
          this.push(null);
        } else {
          downloaded += value.length;
          if (onProgress && total > 0) {
            onProgress({
              percent: (downloaded / total) * 100,
              downloaded,
              total,
            });
          }
          this.push(Buffer.from(value));
        }
      },
    });

    await finished(readable.pipe(fileStream));

    // Rename temp file to final path
    const { renameSync } = await import("node:fs");
    renameSync(tempPath, outputPath);

    return { success: true };
  } catch (error) {
    // Clean up temp file on error
    if (existsSync(tempPath)) {
      unlinkSync(tempPath);
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Downloads a Loom video by ID or URL.
 */
export async function downloadLoomVideo(
  urlOrId: string,
  outputPath: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<{ success: boolean; error?: string }> {
  const videoId = urlOrId.includes("loom.com") ? extractLoomId(urlOrId) : urlOrId;

  if (!videoId) {
    return { success: false, error: "Invalid Loom URL or ID" };
  }

  const info = await getLoomVideoInfo(videoId);

  if (!info) {
    return { success: false, error: "Could not fetch video info from Loom" };
  }

  return downloadFile(info.videoUrl, outputPath, onProgress);
}

