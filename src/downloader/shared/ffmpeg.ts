/**
 * FFmpeg utilities shared across video downloaders.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { execa } from "execa";
import { buildAuthHeaders } from "./network.js";
import type { ProgressCallback } from "./types.js";

// ============================================================================
// FFmpeg Availability
// ============================================================================

/**
 * Checks if ffmpeg is available on the system.
 */
export async function checkFfmpeg(): Promise<boolean> {
  try {
    await execa("ffmpeg", ["-version"]);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// FFmpeg Progress Parsing
// ============================================================================

/**
 * Parses duration from ffmpeg output.
 * @returns Duration in seconds, or 0 if not found.
 */
export function parseFfmpegDuration(output: string): number {
  const match = /Duration:\s*(\d{2}):(\d{2}):(\d{2})\.(\d{2})/.exec(output);
  if (!match) return 0;

  const [, hours = "0", mins = "0", secs = "0", centis = "0"] = match;
  return (
    parseInt(hours, 10) * 3600 +
    parseInt(mins, 10) * 60 +
    parseInt(secs, 10) +
    parseInt(centis, 10) / 100
  );
}

/**
 * Parses current time from ffmpeg progress output.
 * @returns Current time in seconds, or 0 if not found.
 */
export function parseFfmpegTime(output: string): number {
  const match = /time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/.exec(output);
  if (!match) return 0;

  const [, hours = "0", mins = "0", secs = "0", centis = "0"] = match;
  return (
    parseInt(hours, 10) * 3600 +
    parseInt(mins, 10) * 60 +
    parseInt(secs, 10) +
    parseInt(centis, 10) / 100
  );
}

// ============================================================================
// FFmpeg Operations
// ============================================================================

function getTemporaryOutput(outputPath: string): { tempPath: string; format: string } {
  const extension = path.extname(outputPath).toLowerCase();
  const formatByExtension: Record<string, string> = {
    ".m4a": "ipod",
    ".m4v": "mp4",
    ".mkv": "matroska",
    ".mov": "mov",
    ".mp3": "mp3",
    ".mp4": "mp4",
    ".ts": "mpegts",
    ".webm": "webm",
  };
  const format = formatByExtension[extension];
  if (!format) {
    throw new Error(`Unsupported ffmpeg output extension: ${extension || "none"}`);
  }
  return { tempPath: `${outputPath}.tmp`, format };
}

function removeTemporaryOutput(tempPath: string): void {
  try {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  } catch {
    // Cleanup is best-effort; preserve the operation's original failure result.
  }
}

/**
 * Merges video and audio files using ffmpeg.
 * @returns true if merge was successful, false otherwise.
 */
export async function mergeVideoAudio(
  videoPath: string,
  audioPath: string,
  outputPath: string
): Promise<boolean> {
  let tempPath: string | undefined;

  try {
    const output = getTemporaryOutput(outputPath);
    tempPath = output.tempPath;
    await execa(
      "ffmpeg",
      [
        "-nostdin",
        "-i",
        videoPath,
        "-i",
        audioPath,
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-y",
        "-f",
        output.format,
        tempPath,
      ],
      { stdio: "ignore" }
    );

    fs.renameSync(tempPath, outputPath);

    // Clean up temp files
    if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
    return true;
  } catch {
    if (tempPath) removeTemporaryOutput(tempPath);
    // Clean up temp files on failure too
    if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
    return false;
  }
}

/**
 * Concatenates segment files using ffmpeg concat demuxer.
 */
export async function concatSegments(
  segmentPaths: string[],
  outputPath: string,
  tempDir: string
): Promise<boolean> {
  const concatPath = path.join(tempDir, "concat.txt");
  const concatContent = segmentPaths.map((p) => `file '${p}'`).join("\n");
  fs.writeFileSync(concatPath, concatContent);
  let tempPath: string | undefined;

  try {
    const output = getTemporaryOutput(outputPath);
    tempPath = output.tempPath;
    await execa("ffmpeg", [
      "-y",
      "-nostdin",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatPath,
      "-c",
      "copy",
      "-f",
      output.format,
      tempPath,
    ]);
    fs.renameSync(tempPath, outputPath);
    return true;
  } catch {
    if (tempPath) removeTemporaryOutput(tempPath);
    return false;
  }
}

/**
 * Downloads an HLS stream using ffmpeg.
 * Builds headers and runs ffmpeg with progress tracking.
 */
export async function downloadWithFfmpeg(
  hlsUrl: string,
  outputPath: string,
  options: {
    cookies?: string | undefined;
    referer?: string | undefined;
    authToken?: string | undefined;
    onProgress?: ProgressCallback | undefined;
  } = {}
): Promise<{ success: boolean; duration: number; error?: string }> {
  const { cookies, referer, authToken, onProgress } = options;
  let tempPath: string | undefined;

  let duration = 0;
  let currentTime = 0;
  let lastProgressUpdate = 0;

  const updateProgress = () => {
    if (duration > 0 && onProgress) {
      const percent = Math.min((currentTime / duration) * 100, 100);
      const now = Date.now();

      if (now - lastProgressUpdate > 200 || percent >= 100) {
        lastProgressUpdate = now;
        onProgress({
          phase: "downloading",
          percent: Math.round(percent),
          downloadedBytes: currentTime,
          totalBytes: duration,
        });
      }
    }
  };

  try {
    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const output = getTemporaryOutput(outputPath);
    tempPath = output.tempPath;

    // Build ffmpeg command
    const args = ["-y", "-hide_banner", "-loglevel", "warning", "-stats"];

    const headers = buildAuthHeaders(hlsUrl, { cookies, referer, authToken });
    const headerParts = Object.entries(headers).flatMap(([name, value]) =>
      value && name !== "Accept" ? [`${name}: ${value}`] : []
    );
    args.push("-headers", headerParts.join("\r\n") + "\r\n");

    args.push(
      "-nostdin",
      "-i",
      hlsUrl,
      "-c",
      "copy",
      "-bsf:a",
      "aac_adtstoasc",
      "-f",
      output.format,
      tempPath
    );

    const subprocess = execa("ffmpeg", args);

    subprocess.stderr?.on("data", (data: Buffer) => {
      const stderrOutput = data.toString();

      if (duration === 0) {
        duration = parseFfmpegDuration(stderrOutput);
      }

      const time = parseFfmpegTime(stderrOutput);
      if (time > 0) {
        currentTime = time;
        updateProgress();
      }
    });

    await subprocess;
    fs.renameSync(tempPath, outputPath);

    onProgress?.({ phase: "complete", percent: 100 });

    return { success: true, duration };
  } catch (error) {
    if (tempPath) removeTemporaryOutput(tempPath);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, duration: 0, error: `ffmpeg error: ${errorMessage}` };
  }
}
