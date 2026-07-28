import { basename, dirname, extname, join } from "node:path";
import type { Config } from "../config/schema.js";
import { outputFile } from "../shared/fs.js";
import type { CourseDatabase, TranscriptionCandidate } from "../state/index.js";
import {
  CuttledocCliError,
  inspectCuttledocVersion,
  resolveCuttledocProcessOptions,
  transcribeWithCuttledoc,
  type CuttledocProcessRunner,
  type TranscriptionCliOptions,
} from "./cuttledoc.js";

export interface CourseTranscriptionOptions extends TranscriptionCliOptions {
  force?: boolean;
  shouldContinue?: () => boolean;
  runner?: CuttledocProcessRunner;
  onProgress?: (event: CourseTranscriptionProgress) => void;
}

export interface CourseTranscriptionProgress {
  phase: "starting" | "completed" | "error";
  candidate: TranscriptionCandidate;
  completed: number;
  total: number;
  error?: string;
}

export interface CourseTranscriptionFailure {
  videoId: number;
  videoPath: string;
  lessonName: string;
  code: string;
  message: string;
}

export interface CourseTranscriptionSummary {
  attempted: number;
  completed: number;
  skipped: number;
  failures: CourseTranscriptionFailure[];
  cuttledocVersion: string | null;
  wallDurationMs: number;
  processingDurationMs: number;
  estimatedProcessOverheadMs: number;
}

export interface TranscriptOutputPaths {
  jsonPath: string;
  markdownPath: string;
}

export async function transcribeCourseVideos(
  database: CourseDatabase,
  config: Config,
  cli: CourseTranscriptionOptions
): Promise<CourseTranscriptionSummary> {
  const processOptions = resolveCuttledocProcessOptions(config, cli);
  const maxAttempts = config.retryAttempts + 1;
  const candidates = database.getTranscriptionCandidates(maxAttempts, cli.force ?? false);
  const summary: CourseTranscriptionSummary = {
    attempted: 0,
    completed: 0,
    skipped: 0,
    failures: [],
    cuttledocVersion: null,
    wallDurationMs: 0,
    processingDurationMs: 0,
    estimatedProcessOverheadMs: 0,
  };
  if (candidates.length === 0) return summary;

  const runner = cli.runner;
  const cuttledocVersion = await inspectCuttledocVersion(
    { executable: processOptions.executable },
    runner
  );
  summary.cuttledocVersion = cuttledocVersion;
  const shouldContinue = cli.shouldContinue ?? (() => true);

  for (const candidate of candidates) {
    if (!shouldContinue()) {
      summary.skipped += candidates.length - summary.attempted;
      break;
    }

    summary.attempted++;
    cli.onProgress?.({
      phase: "starting",
      candidate,
      completed: summary.completed,
      total: candidates.length,
    });
    database.markTranscriptionStarted(candidate.videoId, {
      language: processOptions.language,
      backend: processOptions.backend,
      enhancement: processOptions.enhancement,
      cuttledocVersion,
    });

    try {
      const run = await transcribeWithCuttledoc(candidate.videoPath, processOptions, runner);
      const outputPaths = transcriptOutputPaths(candidate.videoPath);
      await writeTranscriptOutputs(outputPaths, candidate.lessonName, run.result);
      database.markTranscriptionCompleted(candidate.videoId, {
        ...outputPaths,
        wallDurationMs: run.wallDurationMs,
        mediaDurationMs: run.result.media_duration_ms,
        processingDurationMs: run.result.processing_duration_ms,
      });

      summary.completed++;
      summary.wallDurationMs += run.wallDurationMs;
      summary.processingDurationMs += run.result.processing_duration_ms;
      summary.estimatedProcessOverheadMs += Math.max(
        0,
        run.wallDurationMs - run.result.processing_duration_ms
      );
      cli.onProgress?.({
        phase: "completed",
        candidate,
        completed: summary.completed,
        total: candidates.length,
      });
    } catch (error) {
      const failure = transcriptionFailure(candidate, error);
      database.markTranscriptionError(candidate.videoId, failure.code, failure.message);
      summary.failures.push(failure);
      cli.onProgress?.({
        phase: "error",
        candidate,
        completed: summary.completed,
        total: candidates.length,
        error: failure.message,
      });
    }
  }

  return summary;
}

export function transcriptOutputPaths(videoPath: string): TranscriptOutputPaths {
  const extension = extname(videoPath);
  const stem = basename(videoPath, extension) || basename(videoPath);
  const directory = dirname(videoPath);
  return {
    jsonPath: join(directory, `${stem}.transcript.json`),
    markdownPath: join(directory, `${stem}.transcript.md`),
  };
}

async function writeTranscriptOutputs(
  paths: TranscriptOutputPaths,
  lessonName: string,
  result: {
    text: string;
    [key: string]: unknown;
  }
): Promise<void> {
  await outputFile(paths.jsonPath, `${JSON.stringify(result, null, 2)}\n`);
  const text = result.text.trim();
  const markdown = [`# ${lessonName}`, "", text, ""].join("\n");
  await outputFile(paths.markdownPath, markdown);
}

function transcriptionFailure(
  candidate: TranscriptionCandidate,
  error: unknown
): CourseTranscriptionFailure {
  const message = boundedMessage(error instanceof Error ? error.message : String(error));
  return {
    videoId: candidate.videoId,
    videoPath: candidate.videoPath,
    lessonName: candidate.lessonName,
    code: error instanceof CuttledocCliError ? error.code : "TRANSCRIPTION_FAILED",
    message,
  };
}

function boundedMessage(value: string): string {
  const normalized = value.trim().replaceAll(/\s+/gu, " ");
  return normalized.length <= 500 ? normalized : `${normalized.slice(0, 497)}...`;
}
