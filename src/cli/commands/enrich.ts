import chalk from "chalk";
import ora from "ora";
import { existsSync, readdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import {
  transcribeVideo,
  type WhisperModel,
} from "../../transcription/whisperService.js";
import { polishTranscript, generateModuleSummary, folderNameToTitle } from "../../ai/transcriptPolisher.js";
import {
  isConfigured as isOpenRouterConfigured,
  getCumulativeUsage,
  resetCumulativeUsage,
} from "../../ai/openRouter.js";

interface EnrichOptions {
  model?: WhisperModel;
  language?: string;
  force?: boolean;
  limit?: number;
  polish?: boolean;
}

interface LessonMeta {
  syncedAt: string;
  updatedAt: string | null;
  videoUrl: string | null;
  videoType: string | null;
  transcribedAt?: string;
  polishedAt?: string;
}

interface LessonInfo {
  path: string;
  name: string;
  moduleDir: string;
  moduleName: string;
}

/**
 * Find all lesson directories with videos, grouped by module.
 */
function findLessonsWithVideos(courseDir: string): LessonInfo[] {
  const lessons: LessonInfo[] = [];

  function scanDir(dir: string): void {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        const videoPath = join(fullPath, "video.mp4");
        if (existsSync(videoPath)) {
          // This is a lesson directory
          const moduleDir = dirname(fullPath);
          lessons.push({
            path: fullPath,
            name: entry.name,
            moduleDir,
            moduleName: basename(moduleDir),
          });
        } else {
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
  return (
    existsSync(join(lessonDir, "transcript.md")) ||
    existsSync(join(lessonDir, "transcript-raw.txt"))
  );
}

/**
 * Check if a lesson has been polished.
 */
function isPolished(lessonDir: string): boolean {
  const meta = loadMeta(lessonDir);
  return !!meta?.polishedAt;
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
 * Group lessons by module directory.
 */
function groupByModule(lessons: LessonInfo[]): Map<string, LessonInfo[]> {
  const modules = new Map<string, LessonInfo[]>();

  for (const lesson of lessons) {
    const existing = modules.get(lesson.moduleDir) ?? [];
    existing.push(lesson);
    modules.set(lesson.moduleDir, existing);
  }

  return modules;
}

/**
 * Enrich command - transcribe videos in a course directory.
 */
export async function enrichCommand(
  courseDir: string,
  options: EnrichOptions
): Promise<void> {
  console.log(chalk.blue("\n📝 Enrich: Video Transcription\n"));

  if (!existsSync(courseDir)) {
    console.log(chalk.red(`Course directory not found: ${courseDir}`));
    process.exit(1);
  }

  const model = options.model ?? "small";
  const language = options.language ?? "de";
  const shouldPolish = options.polish ?? false;

  console.log(chalk.gray(`   Model: ${model}`));
  console.log(chalk.gray(`   Language: ${language}`));
  if (shouldPolish) {
    if (isOpenRouterConfigured()) {
      console.log(chalk.gray(`   Polish: enabled (OpenRouter)`));
      resetCumulativeUsage(); // Reset usage tracking
    } else {
      console.log(chalk.yellow(`   Polish: disabled (OPENROUTER_API_KEY not set)`));
    }
  }
  console.log(chalk.gray(`   Directory: ${courseDir}\n`));

  // Find all lessons with videos
  const allLessons = findLessonsWithVideos(courseDir);
  console.log(chalk.gray(`   Found ${allLessons.length} lessons with videos\n`));

  if (allLessons.length === 0) {
    console.log(chalk.yellow("No videos found to transcribe."));
    return;
  }

  // Filter lessons that need processing
  let lessonsToProcess = allLessons.filter((lesson) => {
    if (options.force) return true;
    if (shouldPolish && hasTranscript(lesson.path) && !isPolished(lesson.path)) {
      return true;
    }
    return !hasTranscript(lesson.path);
  });

  if (options.limit) {
    lessonsToProcess = lessonsToProcess.slice(0, options.limit);
  }

  if (lessonsToProcess.length === 0) {
    console.log(chalk.green("All videos already transcribed. Use --force to re-transcribe."));
    return;
  }

  console.log(chalk.blue(`Processing ${lessonsToProcess.length} videos...\n`));

  let transcribed = 0;
  let polished = 0;
  let failed = 0;

  // Track polished lessons for module summaries
  const polishedLessons: LessonInfo[] = [];

  for (const lesson of lessonsToProcess) {
    const videoPath = join(lesson.path, "video.mp4");
    const transcriptMdPath = join(lesson.path, "transcript.md");
    const summaryPath = join(lesson.path, "summary.md");
    const transcriptTxtPath = join(lesson.path, "transcript-raw.txt");

    const spinner = ora(`   ${lesson.name}`).start();

    try {
      let transcriptText: string;

      // Check if we already have a raw transcript
      if (existsSync(transcriptTxtPath) && shouldPolish && !options.force) {
        transcriptText = readFileSync(transcriptTxtPath, "utf-8");
        spinner.text = `   ${lesson.name} (polishing...)`;
      } else {
        // Transcribe video
        const result = await transcribeVideo(videoPath, { model, language });
        transcriptText = result.text;

        writeFileSync(transcriptTxtPath, transcriptText, "utf-8");

        const speedFactor =
          result.duration > 0
            ? (result.duration / result.processingTime).toFixed(1)
            : "?";

        spinner.text = `   ${lesson.name} (${Math.round(result.duration)}s → ${result.processingTime.toFixed(1)}s, ${speedFactor}x)`;
        transcribed++;
      }

      // Polish with LLM if requested
      if (shouldPolish && isOpenRouterConfigured()) {
        spinner.text = `   ${lesson.name} (polishing with AI...)`;

        try {
          const polishedResult = await polishTranscript(transcriptText);

          // Save summary separately
          const lessonTitle = folderNameToTitle(lesson.name);
          if (polishedResult.summary) {
            writeFileSync(summaryPath, `# Zusammenfassung: ${lessonTitle}\n\n${polishedResult.summary}\n`, "utf-8");
          }

          // Save formatted transcript with title
          const transcriptWithTitle = `# Transkript: ${lessonTitle}\n\n${polishedResult.transcript}`;
          writeFileSync(transcriptMdPath, transcriptWithTitle, "utf-8");
          polished++;
          polishedLessons.push(lesson);

          const meta = loadMeta(lesson.path) ?? {
            syncedAt: new Date().toISOString(),
            updatedAt: null,
            videoUrl: null,
            videoType: null,
          };
          meta.polishedAt = new Date().toISOString();
          saveMeta(lesson.path, meta);
        } catch (polishError) {
          // Save unpolished as fallback
          writeFileSync(transcriptMdPath, transcriptText, "utf-8");
          console.log(chalk.yellow(`\n      Polish failed: ${polishError}`));
        }
      } else {
        // Save raw transcript as markdown
        writeFileSync(transcriptMdPath, transcriptText, "utf-8");
      }

      // Update metadata
      const meta = loadMeta(lesson.path) ?? {
        syncedAt: new Date().toISOString(),
        updatedAt: null,
        videoUrl: null,
        videoType: null,
      };
      meta.transcribedAt = new Date().toISOString();
      saveMeta(lesson.path, meta);

      const statusSuffix = shouldPolish && isOpenRouterConfigured() ? " + polished" : "";
      spinner.succeed(`   ${lesson.name}${statusSuffix}`);
    } catch (error) {
      spinner.fail(`   ${lesson.name}`);
      console.log(chalk.red(`      Error: ${error}`));
      failed++;
    }
  }

  // Generate module summaries if we polished any lessons
  if (polished > 0 && isOpenRouterConfigured()) {
    console.log(chalk.blue("\n📚 Generating module summaries...\n"));

    const moduleGroups = groupByModule(polishedLessons);

    for (const [moduleDir, moduleLessons] of moduleGroups) {
      const moduleName = basename(moduleDir);
      const spinner = ora(`   ${moduleName}`).start();

      try {
        // Collect all lesson summaries for this module
        const lessonSummaries: Array<{ name: string; title: string; summary: string }> = [];

        for (const lesson of moduleLessons) {
          const summaryPath = join(lesson.path, "summary.md");
          if (existsSync(summaryPath)) {
            const content = readFileSync(summaryPath, "utf-8");
            // Extract just the summary text (skip the heading)
            const summaryText = content.replace(/^#[^\n]+\n+/, "").trim();
            const lessonTitle = folderNameToTitle(lesson.name);
            lessonSummaries.push({ name: lesson.name, title: lessonTitle, summary: summaryText });
          }
        }

        if (lessonSummaries.length > 0) {
          const moduleSummary = await generateModuleSummary(moduleName, lessonSummaries);
          const moduleSummaryPath = join(moduleDir, "summary.md");
          writeFileSync(moduleSummaryPath, moduleSummary, "utf-8");
          spinner.succeed(`   ${moduleName} (${lessonSummaries.length} lessons)`);
        } else {
          spinner.warn(`   ${moduleName} (no summaries found)`);
        }
      } catch (error) {
        spinner.fail(`   ${moduleName}`);
        console.log(chalk.red(`      Error: ${error}`));
      }
    }
  }

  // Final summary
  console.log(chalk.green(`\n✅ Enrichment complete!`));
  console.log(chalk.gray(`   Transcribed: ${transcribed}`));
  if (polished > 0) {
    console.log(chalk.gray(`   Polished: ${polished}`));
  }
  if (failed > 0) {
    console.log(chalk.red(`   Failed: ${failed}`));
  }

  // Show API usage if polishing was done
  if (polished > 0 && isOpenRouterConfigured()) {
    const usage = getCumulativeUsage();
    console.log(chalk.gray(`\n   API Usage:`));
    console.log(chalk.gray(`     Tokens: ${usage.totalTokens.toLocaleString()} (${usage.promptTokens.toLocaleString()} in / ${usage.completionTokens.toLocaleString()} out)`));
    if (usage.cost !== undefined && usage.cost > 0) {
      console.log(chalk.gray(`     Cost: $${usage.cost.toFixed(4)}`));
    }
  }
}
