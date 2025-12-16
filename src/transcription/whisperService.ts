import { execSync } from "node:child_process";
import { existsSync, unlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { nodewhisper } from "nodejs-whisper";

export type WhisperModel = "tiny" | "base" | "small" | "medium" | "large";

export interface TranscriptionOptions {
  model?: WhisperModel;
  language?: string;
}

export interface TranscriptionResult {
  text: string;            // Plain text without timestamps
  duration: number;
  processingTime: number;
}

/**
 * Strip timestamps from Whisper output and return plain text.
 */
function stripTimestamps(rawText: string): string {
  return rawText
    .replace(/\[\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}\]\s*/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ");
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
  const model = options.model ?? "small";
  const language = options.language ?? "de";

  const startTime = performance.now();

  // nodejs-whisper writes output to a .txt file alongside the input
  await nodewhisper(audioPath, {
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

  // Read the generated transcript file
  const txtPath = `${audioPath}.txt`;
  let rawText = "";
  if (existsSync(txtPath)) {
    rawText = readFileSync(txtPath, "utf-8").trim();
    // Clean up the txt file
    unlinkSync(txtPath);
  }

  // Strip timestamps, return plain text (LLM will format it)
  const text = stripTimestamps(rawText);

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
    text,
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
export function checkModel(_model: WhisperModel): boolean {
  // Models are stored in nodejs-whisper's models directory
  // They are auto-downloaded on first actual transcription
  return true; // Let nodejs-whisper handle downloads
}

