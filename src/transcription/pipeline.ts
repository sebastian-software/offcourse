import {
  inspectTranscriptOutputs,
  transcriptOutputPaths,
  writeTranscriptMarkdown,
  writeTranscriptOutputs,
} from "./outputs.js";
import type { Config } from "../config/schema.js";
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

export { transcriptOutputPaths, type TranscriptOutputPaths } from "./outputs.js";

export async function transcribeCourseVideos(
  database: CourseDatabase,
  config: Config,
  cli: CourseTranscriptionOptions
): Promise<CourseTranscriptionSummary> {
  const processOptions = resolveCuttledocProcessOptions(config, cli);
  // Files determine what is missing. Each explicit sync retries unfinished videos once,
  // including jobs whose historical attempt count exceeded the old retry limit.
  const candidates = database.getTranscriptionCandidates(config.retryAttempts + 1, true);
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
  const shouldContinue = cli.shouldContinue ?? (() => true);
  const pending: { candidate: TranscriptionCandidate; replaceMarkdown: boolean }[] = [];
  for (const candidate of candidates) {
    if (!shouldContinue()) return summary;
    try {
      const existing = await inspectTranscriptOutputs(candidate.videoPath);
      if (!cli.force && existing.result) {
        if (!existing.hasMarkdown) {
          await writeTranscriptMarkdown(
            transcriptOutputPaths(candidate.videoPath).markdownPath,
            candidate.lessonName,
            existing.result.text
          );
          summary.attempted++;
          summary.completed++;
          cli.onProgress?.({
            phase: "completed",
            candidate,
            completed: summary.completed,
            total: candidates.length,
          });
        } else {
          summary.skipped++;
        }
        // Recover state after a previous run wrote JSON but failed before completing the job.
        if (candidate.status !== null && candidate.status !== "completed") {
          database.markTranscriptionCompleted(candidate.videoId, {
            ...transcriptOutputPaths(candidate.videoPath),
            wallDurationMs: database.getTranscription(candidate.videoId)?.wallDurationMs ?? 0,
            mediaDurationMs: existing.result.media_duration_ms,
            processingDurationMs: existing.result.processing_duration_ms,
          });
        }
        continue;
      }
      pending.push({ candidate, replaceMarkdown: Boolean(cli.force) || !existing.hasMarkdown });
    } catch (error) {
      const failure = transcriptionFailure(candidate, error);
      summary.attempted++;
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
  if (pending.length === 0) return summary;

  const runner = cli.runner;
  const cuttledocVersion = await inspectCuttledocVersion(
    { executable: processOptions.executable },
    runner
  );
  summary.cuttledocVersion = cuttledocVersion;
  for (const [index, { candidate, replaceMarkdown }] of pending.entries()) {
    if (!shouldContinue()) {
      summary.skipped += pending.length - index;
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
      await writeTranscriptOutputs(
        candidate.videoPath,
        candidate.lessonName,
        run.result,
        replaceMarkdown
      );
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
