/**
 * Progressive (direct) file download utilities.
 * Used for MP4, WebM, and other direct video file downloads.
 */
import { createWriteStream, existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { USER_AGENT } from "../../shared/http.js";
import type { DownloadResult, ProgressCallback, RequestHeaders } from "./types.js";

// ============================================================================
// Direct File Download
// ============================================================================

/**
 * Downloads a file directly via HTTP.
 * Supports progress tracking and authenticated requests.
 */
/* v8 ignore start */
export async function downloadFile(
  url: string,
  outputPath: string,
  options: {
    onProgress?: ProgressCallback | undefined;
    cookies?: string | undefined;
    referer?: string | undefined;
    headers?: RequestHeaders | undefined;
  } = {}
): Promise<DownloadResult> {
  const { onProgress, cookies, referer, headers: extraHeaders } = options;

  if (existsSync(outputPath)) {
    return { success: true, outputPath };
  }

  const dir = dirname(outputPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const tempPath = `${outputPath}.tmp`;

  try {
    const headers: RequestHeaders = {
      "User-Agent": USER_AGENT,
      Referer: referer ?? new URL(url).origin,
      ...extraHeaders,
    };
    if (cookies) {
      headers.Cookie = cookies;
    }

    const response = await fetch(url, { headers: headers as HeadersInit });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}`,
        errorCode: "DOWNLOAD_FAILED",
      };
    }

    const contentLength = response.headers.get("content-length");
    const total = contentLength ? parseInt(contentLength, 10) : 0;

    if (!response.body) {
      return {
        success: false,
        error: "No response body",
        errorCode: "DOWNLOAD_FAILED",
      };
    }

    const fileStream = createWriteStream(tempPath);
    const reader = response.body.getReader();
    let downloaded = 0;

    const readable = new Readable({
      read() {
        reader
          .read()
          .then(({ done, value }) => {
            if (done) {
              this.push(null);
            } else {
              downloaded += value.length;
              if (onProgress && total > 0) {
                onProgress({
                  percent: (downloaded / total) * 100,
                  phase: "downloading",
                  downloadedBytes: downloaded,
                  totalBytes: total,
                });
              }
              this.push(Buffer.from(value));
            }
          })
          .catch((err: unknown) => {
            this.destroy(err instanceof Error ? err : new Error(String(err)));
          });
      },
    });

    await finished(readable.pipe(fileStream));
    renameSync(tempPath, outputPath);

    onProgress?.({ percent: 100, phase: "complete" });

    return { success: true, outputPath };
  } catch (error) {
    if (existsSync(tempPath)) unlinkSync(tempPath);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      errorCode: "DOWNLOAD_FAILED",
    };
  }
}

/**
 * Downloads a progressive video file with streaming.
 * Similar to downloadFile but uses a simpler stream approach.
 */
export async function downloadProgressiveVideo(
  url: string,
  outputPath: string,
  options: {
    onProgress?: ProgressCallback | undefined;
    referer?: string | undefined;
    headers?: RequestHeaders | undefined;
  } = {}
): Promise<DownloadResult> {
  const { onProgress, referer, headers: extraHeaders } = options;
  const tempPath = `${outputPath}.tmp`;

  try {
    const headers: RequestHeaders = {
      "User-Agent": USER_AGENT,
      Referer: referer ?? "https://player.vimeo.com/",
      ...extraHeaders,
    };

    const response = await fetch(url, { headers: headers as HeadersInit });

    if (!response.ok) {
      return {
        success: false,
        error: `Download failed: HTTP ${response.status}`,
        errorCode: "DOWNLOAD_FAILED",
      };
    }

    const contentLength = response.headers.get("content-length");
    const total = contentLength ? parseInt(contentLength, 10) : 0;

    if (!response.body) {
      return {
        success: false,
        error: "No response body",
        errorCode: "DOWNLOAD_FAILED",
      };
    }

    const dir = dirname(outputPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const fileStream = createWriteStream(tempPath);
    const reader = response.body.getReader();
    let downloaded = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      fileStream.write(Buffer.from(value));
      downloaded += value.length;

      if (onProgress && total > 0) {
        onProgress({
          percent: (downloaded / total) * 100,
          phase: "downloading",
          downloadedBytes: downloaded,
          totalBytes: total,
        });
      }
    }

    await new Promise<void>((resolve, reject) => {
      fileStream.end((err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });

    renameSync(tempPath, outputPath);
    onProgress?.({ percent: 100, phase: "complete" });

    return { success: true, outputPath };
  } catch (error) {
    if (existsSync(tempPath)) unlinkSync(tempPath);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      errorCode: "DOWNLOAD_FAILED",
    };
  }
}
/* v8 ignore stop */
