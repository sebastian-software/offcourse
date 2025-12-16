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
  text: string;            // Formatted readable text
  rawText: string;         // Original with timestamps
  duration: number;
  processingTime: number;
}

interface Segment {
  start: number;
  end: number;
  text: string;
}

/**
 * Parse timestamp like [00:01:23.456 --> 00:01:25.789] to seconds
 */
function parseTimestamp(line: string): { start: number; end: number; text: string } | null {
  const match = line.match(/\[(\d{2}):(\d{2}):(\d{2}\.\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}\.\d{3})\]\s*(.*)/);
  if (!match) return null;

  const startH = parseInt(match[1] ?? "0", 10);
  const startM = parseInt(match[2] ?? "0", 10);
  const startS = parseFloat(match[3] ?? "0");
  const endH = parseInt(match[4] ?? "0", 10);
  const endM = parseInt(match[5] ?? "0", 10);
  const endS = parseFloat(match[6] ?? "0");

  return {
    start: startH * 3600 + startM * 60 + startS,
    end: endH * 3600 + endM * 60 + endS,
    text: (match[7] ?? "").trim(),
  };
}

/**
 * Format transcript into readable paragraphs.
 * Creates new paragraphs based on:
 * 1. Pauses > threshold
 * 2. Every N sentences for readability
 */
function formatTranscript(rawText: string, pauseThreshold = 0.8): string {
  const lines = rawText.split("\n").filter((l) => l.trim());
  const segments: Segment[] = [];

  for (const line of lines) {
    const parsed = parseTimestamp(line);
    if (parsed && parsed.text) {
      segments.push(parsed);
    }
  }

  if (segments.length === 0) {
    // Fallback: just strip timestamps and add paragraph breaks
    const text = rawText
      .replace(/\[\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}\]\s*/g, "")
      .split("\n")
      .filter((l) => l.trim())
      .join(" ");

    return addParagraphBreaks(text);
  }

  const paragraphs: string[] = [];
  let currentParagraph: string[] = [];
  let sentenceCount = 0;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const prevSegment = segments[i - 1];

    if (!segment) continue;

    // Check if there's a significant pause
    const hasPause = prevSegment && segment.start - prevSegment.end > pauseThreshold;

    // Count sentences in this segment
    const sentenceEnders = (segment.text.match(/[.!?]/g) || []).length;
    sentenceCount += sentenceEnders;

    // Start new paragraph on pause or every ~5 sentences
    if (hasPause || sentenceCount >= 5) {
      if (currentParagraph.length > 0) {
        paragraphs.push(currentParagraph.join(" "));
        currentParagraph = [];
        sentenceCount = 0;
      }
    }

    currentParagraph.push(segment.text);
  }

  // Don't forget the last paragraph
  if (currentParagraph.length > 0) {
    paragraphs.push(currentParagraph.join(" "));
  }

  return paragraphs.join("\n\n");
}

/**
 * Add paragraph breaks to plain text based on sentence patterns.
 */
function addParagraphBreaks(text: string): string {
  // Split into sentences
  const sentences = text.split(/(?<=[.!?])\s+/);

  const paragraphs: string[] = [];
  let current: string[] = [];

  for (const sentence of sentences) {
    current.push(sentence);

    // New paragraph every 4-5 sentences or on topic change indicators
    if (current.length >= 4 ||
        sentence.includes("Und zwar") ||
        sentence.includes("Das bedeutet") ||
        sentence.includes("Das Erste") ||
        sentence.includes("Dann") && current.length >= 2) {
      paragraphs.push(current.join(" "));
      current = [];
    }
  }

  if (current.length > 0) {
    paragraphs.push(current.join(" "));
  }

  return paragraphs.join("\n\n");
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

  // Format into readable paragraphs
  const text = formatTranscript(rawText);

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
    rawText,
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

