import { readdir, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import type { Config } from "../config/schema.js";
import {
  inspectCuttledocVersion,
  resolveCuttledocProcessOptions,
  transcribeWithCuttledoc,
  type CuttledocProcessRunner,
  type TranscriptionCliOptions,
} from "./cuttledoc.js";
import {
  inspectTranscriptOutputs,
  transcriptOutputPaths,
  writeTranscriptMarkdown,
  writeTranscriptOutputs,
} from "./outputs.js";

const videoExtensions = new Set([".mp4", ".m4v", ".mov", ".mkv", ".webm", ".avi", ".mpeg", ".mpg"]);

export interface EnrichArchiveOptions extends TranscriptionCliOptions {
  force?: boolean;
  dryRun?: boolean;
  runner?: CuttledocProcessRunner;
  shouldContinue?: () => boolean;
  onProgress?: (
    path: string,
    phase: "transcribing" | "restored" | "completed" | "pending" | "error"
  ) => void;
}

export interface EnrichArchiveSummary {
  discovered: number;
  completed: number;
  restored: number;
  skipped: number;
  pending: number;
  failures: { path: string; message: string }[];
}

/** Enrich an archive using its sidecar files as state, without platform access or a course DB. */
export async function enrichArchive(
  directory: string,
  config: Config,
  options: EnrichArchiveOptions = {}
): Promise<EnrichArchiveSummary> {
  const root = resolve(directory);
  if (!(await stat(root)).isDirectory()) throw new Error(`Not a directory: ${root}`);
  const videos = await findVideos(root);
  // Different extensions with the same stem would share output files. Reject before writing.
  const outputs = new Set<string>();
  for (const video of videos) {
    const output = transcriptOutputPaths(video).jsonPath;
    if (outputs.has(output)) throw new Error(`Videos share a transcript filename: ${output}`);
    outputs.add(output);
  }
  const summary: EnrichArchiveSummary = {
    discovered: videos.length,
    completed: 0,
    restored: 0,
    skipped: 0,
    pending: 0,
    failures: [],
  };
  const processOptions = resolveCuttledocProcessOptions(config, options);
  let inspected = false;
  for (const [index, video] of videos.entries()) {
    if (options.shouldContinue && !options.shouldContinue()) {
      summary.pending += videos.length - index;
      break;
    }
    try {
      const existing = await inspectTranscriptOutputs(video);
      if (!options.force && existing.result && existing.hasMarkdown) {
        summary.skipped++;
        continue;
      }
      if (options.dryRun) {
        summary.pending++;
        options.onProgress?.(video, "pending");
        continue;
      }
      const title = basename(video, extname(video));
      if (!options.force && existing.result) {
        await writeTranscriptMarkdown(
          transcriptOutputPaths(video).markdownPath,
          title,
          existing.result.text
        );
        summary.restored++;
        options.onProgress?.(video, "restored");
        continue;
      }
      if (!inspected) {
        await inspectCuttledocVersion(processOptions, options.runner);
        inspected = true;
      }
      options.onProgress?.(video, "transcribing");
      const run = await transcribeWithCuttledoc(video, processOptions, options.runner);
      await writeTranscriptOutputs(
        video,
        title,
        run.result,
        Boolean(options.force) || !existing.hasMarkdown
      );
      summary.completed++;
      options.onProgress?.(video, "completed");
    } catch (error) {
      // A missing/broken installation affects the whole archive. Stop before repeating the probe.
      if (!inspected && error instanceof Error && error.name === "CuttledocCliError") throw error;
      summary.failures.push({
        path: video,
        message: error instanceof Error ? error.message : String(error),
      });
      options.onProgress?.(video, "error");
    }
  }
  return summary;
}

async function findVideos(directory: string): Promise<string[]> {
  const videos: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) videos.push(...(await findVideos(path)));
    else if (entry.isFile() && videoExtensions.has(extname(entry.name).toLowerCase()))
      videos.push(path);
  }
  return videos;
}
