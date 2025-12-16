import chalk from "chalk";
import ora from "ora";
import { existsSync, readdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  transcribeVideo,
  type WhisperModel,
} from "../../transcription/whisperService.js";

interface EnrichOptions {
  model?: WhisperModel;
  language?: string;
  force?: boolean;
  limit?: number;
}

interface LessonMeta {
  syncedAt: string;
  updatedAt: string | null;
  videoUrl: string | null;
  videoType: string | null;
  transcribedAt?: string;
}

/**
 * Find all lesson directories with videos.
 */
function findLessonsWithVideos(courseDir: string): string[] {
  const lessons: string[] = [];

  function scanDir(dir: string): void {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        // Check if this directory has a video.mp4
        const videoPath = join(fullPath, "video.mp4");
        if (existsSync(videoPath)) {
          lessons.push(fullPath);
        } else {
          // Recurse into subdirectories
          scanDir(fullPath);
        }
      }
    }
  }

  scanDir(courseDir);
  return lessons;
}

/**
 * Check if a lesson already has a transcript.
 */
function hasTranscript(lessonDir: string): boolean {
  return existsSync(join(lessonDir, "transcript.txt"));
}

/**
 * Load lesson metadata.
 */
function loadMeta(lessonDir: string): LessonMeta | null {
  const metaPath = join(lessonDir, ".meta.json");
  if (!existsSync(metaPath)) {
    return null;
  }

  try {
    const content = readFileSync(metaPath, "utf-8");
    return JSON.parse(content) as LessonMeta;
  } catch {
    return null;
  }
}

/**
 * Save lesson metadata.
 */
function saveMeta(lessonDir: string, meta: LessonMeta): void {
  const metaPath = join(lessonDir, ".meta.json");
  writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");
}

/**
 * Get lesson name from directory path.
 */
function getLessonName(lessonDir: string): string {
  const parts = lessonDir.split("/");
  return parts[parts.length - 1] ?? "Unknown";
}

/**
 * Enrich command - transcribe videos in a course directory.
 */
export async function enrichCommand(
  courseDir: string,
  options: EnrichOptions
): Promise<void> {
  console.log(chalk.blue("\n📝 Enrich: Video Transcription\n"));

  // Validate course directory
  if (!existsSync(courseDir)) {
    console.log(chalk.red(`Course directory not found: ${courseDir}`));
    process.exit(1);
  }

  // Options with defaults
  const model = options.model ?? "base";
  const language = options.language ?? "de";

  console.log(chalk.gray(`   Model: ${model}`));
  console.log(chalk.gray(`   Language: ${language}`));
  console.log(chalk.gray(`   Directory: ${courseDir}\n`));

  // Find all lessons with videos
  const lessons = findLessonsWithVideos(courseDir);
  console.log(chalk.gray(`\n   Found ${lessons.length} lessons with videos\n`));

  if (lessons.length === 0) {
    console.log(chalk.yellow("No videos found to transcribe."));
    return;
  }

  // Filter lessons that need transcription
  let lessonsToProcess = lessons.filter((lessonDir) => {
    if (options.force) return true;
    return !hasTranscript(lessonDir);
  });

  if (options.limit) {
    lessonsToProcess = lessonsToProcess.slice(0, options.limit);
  }

  if (lessonsToProcess.length === 0) {
    console.log(chalk.green("All videos already transcribed. Use --force to re-transcribe."));
    return;
  }

  console.log(chalk.blue(`Transcribing ${lessonsToProcess.length} videos...\n`));

  let transcribed = 0;
  let failed = 0;

  for (const lessonDir of lessonsToProcess) {
    const lessonName = getLessonName(lessonDir);
    const videoPath = join(lessonDir, "video.mp4");
    const transcriptPath = join(lessonDir, "transcript.txt");

    const spinner = ora(`   ${lessonName}`).start();

    try {
      const result = await transcribeVideo(videoPath, { model, language });

      // Save transcript
      writeFileSync(transcriptPath, result.text, "utf-8");

      // Update metadata
      const meta = loadMeta(lessonDir) ?? {
        syncedAt: new Date().toISOString(),
        updatedAt: null,
        videoUrl: null,
        videoType: null,
      };
      meta.transcribedAt = new Date().toISOString();
      saveMeta(lessonDir, meta);

      const speedFactor = result.duration > 0 
        ? (result.duration / result.processingTime).toFixed(1) 
        : "?";

      spinner.succeed(
        `   ${lessonName} (${Math.round(result.duration)}s → ${result.processingTime.toFixed(1)}s, ${speedFactor}x)`
      );
      transcribed++;
    } catch (error) {
      spinner.fail(`   ${lessonName}`);
      console.log(chalk.red(`      Error: ${error}`));
      failed++;
    }
  }

  // Summary
  console.log(chalk.green(`\n✅ Transcription complete!`));
  console.log(chalk.gray(`   Transcribed: ${transcribed}`));
  if (failed > 0) {
    console.log(chalk.red(`   Failed: ${failed}`));
  }
}

