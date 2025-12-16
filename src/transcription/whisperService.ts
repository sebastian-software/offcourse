import { execSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { nodewhisper } from "nodejs-whisper";

export type WhisperModel = "tiny" | "base" | "small" | "medium" | "large";

export interface TranscriptionOptions {
  model?: WhisperModel;
  language?: string;
}

export interface TranscriptionResult {
  text: string;
  duration: number;
  processingTime: number;
}

/**
 * Extract audio from video file using ffmpeg.
 */
export function extractAudio(videoPath: string): string {
  const tempDir = tmpdir();
  const audioPath = join(tempDir, `${basename(videoPath, ".mp4")}-${Date.now()}.wav`);

  execSync(
    `ffmpeg -i "${videoPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${audioPath}" -y`,
    { stdio: "pipe" }
  );

  return audioPath;
}

/**
 * Transcribe audio file using Whisper.
 */
export async function transcribeAudio(
  audioPath: string,
  options: TranscriptionOptions = {}
): Promise<TranscriptionResult> {
  const model = options.model ?? "base";
  const language = options.language ?? "de";

  const startTime = performance.now();

  // nodejs-whisper returns the transcript
  const result = await nodewhisper(audioPath, {
    modelName: model,
    autoDownloadModelName: model,
    removeWavFileAfterTranscription: false,
    whisperOptions: {
      outputInText: true,
      outputInSrt: false,
      outputInVtt: false,
      translateToEnglish: false,
      language: language,
      wordTimestamps: false,
    },
  });

  const processingTime = (performance.now() - startTime) / 1000;

  // Get audio duration
  let duration = 0;
  try {
    const durationOutput = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`,
      { encoding: "utf-8" }
    );
    duration = parseFloat(durationOutput.trim()) || 0;
  } catch {
    // Ignore duration errors
  }

  return {
    text: typeof result === "string" ? result.trim() : String(result).trim(),
    duration,
    processingTime,
  };
}

/**
 * Transcribe a video file (extracts audio first).
 */
export async function transcribeVideo(
  videoPath: string,
  options: TranscriptionOptions = {}
): Promise<TranscriptionResult> {
  if (!existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }

  // Extract audio
  const audioPath = extractAudio(videoPath);

  try {
    // Transcribe
    const result = await transcribeAudio(audioPath, options);
    return result;
  } finally {
    // Cleanup temp audio file
    if (existsSync(audioPath)) {
      unlinkSync(audioPath);
    }
  }
}

/**
 * Check if whisper model exists (models are auto-downloaded on first use).
 */
export function checkModel(model: WhisperModel): boolean {
  // Models are stored in nodejs-whisper's models directory
  // They are auto-downloaded on first actual transcription
  return true; // Let nodejs-whisper handle downloads
}

