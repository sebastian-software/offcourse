import chalk from "chalk";
import cliProgress from "cli-progress";
import type { BrowserContext, Page } from "playwright";
import {
  downloadVideo,
  type DownloadResult,
  type ProgressCallback,
  type VideoDownloadTask,
} from "../downloader/index.js";
import { parallelProcess, type ParallelWorkerResult } from "../shared/parallelWorker.js";

const PROGRESS_FORMAT = "   {bar} {percentage}% | {value}/{total} | {status}";

/** Creates the standard progress bar used by sync pipeline stages. */
export function createSyncProgressBar(): cliProgress.SingleBar {
  return new cliProgress.SingleBar(
    {
      format: PROGRESS_FORMAT,
      barCompleteChar: "█",
      barIncompleteChar: "░",
      barsize: 30,
      hideCursor: true,
    },
    cliProgress.Presets.shades_grey
  );
}

export interface ParallelSyncStageOptions<TTask, TResult> {
  context: BrowserContext;
  mainPage: Page;
  tasks: TTask[];
  concurrency: number;
  shouldContinue?: () => boolean;
  processTask: (page: Page, task: TTask, index: number) => Promise<TResult>;
  getTaskLabel: (task: TTask, index: number) => string;
  onError?: (error: unknown, taskIndex: number) => void;
}

/**
 * Runs one extraction stage with the shared browser-worker and progress lifecycle.
 */
export async function runParallelSyncStage<TTask, TResult>(
  options: ParallelSyncStageOptions<TTask, TResult>
): Promise<ParallelWorkerResult<TResult>> {
  const {
    context,
    mainPage,
    tasks,
    processTask,
    getTaskLabel,
    shouldContinue = () => true,
    onError,
  } = options;

  if (tasks.length === 0) return { results: [], errors: [] };

  const progressBar = createSyncProgressBar();
  progressBar.start(tasks.length, 0, { status: "Starting..." });
  let processed = 0;

  try {
    return await parallelProcess(
      context,
      mainPage,
      tasks,
      async (page, task, index) => {
        try {
          return await processTask(page, task, index);
        } finally {
          processed++;
          progressBar.update(processed, {
            status: truncateSyncLabel(getTaskLabel(task, index)),
          });
        }
      },
      {
        concurrency: Math.min(Math.max(options.concurrency, 1), tasks.length),
        shouldContinue,
        onError: onError ?? (() => undefined),
        onWorkerPoolFallback: (activeWorkers) => {
          const message =
            activeWorkers === 1
              ? "Could not create parallel tabs, falling back to sequential"
              : `Could not create all parallel tabs, continuing with ${activeWorkers} workers`;
          console.error(chalk.yellow(`\n   ${message}`));
        },
      }
    );
  } finally {
    progressBar.stop();
  }
}

export interface VideoDownloadOutcome {
  task: VideoDownloadTask;
  result?: DownloadResult;
  error?: string;
}

export interface VideoDownloadFailure extends VideoDownloadOutcome {
  error: string;
}

export interface VideoDownloadSummary {
  completed: number;
  failures: VideoDownloadFailure[];
  outcomes: VideoDownloadOutcome[];
}

export interface DownloadVideoTasksOptions {
  concurrency: number;
  shouldContinue?: () => boolean;
  heading?: string;
  downloadTask?: (task: VideoDownloadTask, onProgress: ProgressCallback) => Promise<DownloadResult>;
}

/**
 * Downloads video tasks through the shared concurrent queue and progress display.
 */
export async function downloadVideoTasks(
  tasks: VideoDownloadTask[],
  options: DownloadVideoTasksOptions
): Promise<VideoDownloadSummary> {
  if (tasks.length === 0) return { completed: 0, failures: [], outcomes: [] };

  const shouldContinue = options.shouldContinue ?? (() => true);
  const runDownload = options.downloadTask ?? downloadVideo;
  const heading = options.heading ?? `Downloading ${tasks.length} videos...`;
  console.log(chalk.blue(`\n🎬 ${heading}\n`));

  const multibar = new cliProgress.MultiBar(
    {
      clearOnComplete: true,
      hideCursor: true,
      format: "   {typeTag} {bar} {percentage}% | {lessonName}",
      barCompleteChar: "█",
      barIncompleteChar: "░",
      barsize: 25,
      autopadding: true,
    },
    cliProgress.Presets.shades_grey
  );
  const overallBar = multibar.create(tasks.length, 0, {
    typeTag: "[TOTAL]".padEnd(8),
    lessonName: `0/${tasks.length} processed`,
  });

  const queue = tasks.map((task, index) => ({ task, index }));
  const outcomes: (VideoDownloadOutcome | undefined)[] = tasks.map(() => undefined);
  let processed = 0;
  let completed = 0;
  let failed = 0;

  const runWorker = async (): Promise<void> => {
    while (shouldContinue() && queue.length > 0) {
      const item = queue.shift();
      if (!item) break;

      const { task, index } = item;
      const typeTag = task.videoType ? `[${task.videoType.toUpperCase()}]` : "[VIDEO]";
      const bar = multibar.create(100, 0, {
        typeTag: typeTag.padEnd(8),
        lessonName: truncateSyncLabel(task.lessonName),
      });

      try {
        const result = await runDownload(task, (progress) => {
          bar.update(Math.round(progress.percent));
        });
        if (result.success) {
          completed++;
          outcomes[index] = { task, result };
        } else {
          failed++;
          outcomes[index] = {
            task,
            result,
            error: result.error ?? "Download failed",
          };
        }
      } catch (error) {
        failed++;
        outcomes[index] = {
          task,
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        processed++;
        multibar.remove(bar);
        overallBar.update(processed, {
          lessonName: `${processed}/${tasks.length} processed (${completed} succeeded, ${failed} failed)`,
        });
      }
    }
  };

  try {
    await Promise.all(
      Array.from({ length: Math.min(Math.max(options.concurrency, 1), tasks.length) }, runWorker)
    );
  } finally {
    multibar.stop();
  }

  const finishedOutcomes = outcomes.filter(
    (outcome): outcome is VideoDownloadOutcome => outcome !== undefined
  );
  const failures = finishedOutcomes.filter(
    (outcome): outcome is VideoDownloadFailure => outcome.error !== undefined
  );

  console.log();
  const interrupted = processed < tasks.length;
  if (interrupted) {
    console.log(
      chalk.yellow(
        `   Download interrupted: ${completed} downloaded, ${failed} failed, ${tasks.length - processed} remaining`
      )
    );
  } else if (failed === 0) {
    console.log(chalk.green(`   ✓ ${completed} videos downloaded successfully`));
  } else {
    console.log(chalk.yellow(`   Videos: ${completed} downloaded, ${failed} failed`));
    console.log(chalk.yellow("\n   Failed downloads:"));
    for (const failure of failures) {
      const typeTag = failure.task.videoType ? `[${failure.task.videoType.toUpperCase()}] ` : "";
      console.log(chalk.red(`   - ${typeTag}${failure.task.lessonName}: ${failure.error}`));
    }
  }

  return { completed, failures, outcomes: finishedOutcomes };
}

export interface HtmlLessonMarkdownOptions {
  title: string;
  description?: string | null;
  htmlContent?: string | null;
  videoUrl?: string | undefined;
}

/** Formats the shared HighLevel-style HTML lesson representation as Markdown. */
export function formatHtmlLessonMarkdown(options: HtmlLessonMarkdownOptions): string {
  const lines = [`# ${options.title}`, ""];

  if (options.description) {
    lines.push(options.description, "");
  }

  if (options.videoUrl) {
    lines.push("## Video", "", `Video URL: ${options.videoUrl}`, "");
  }

  if (options.htmlContent) {
    const text = options.htmlContent
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<li>/gi, "- ")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .trim();
    lines.push("---", "", text, "");
  }

  return lines.join("\n");
}

function truncateSyncLabel(label: string): string {
  return label.length > 40 ? `${label.slice(0, 37)}...` : label;
}
