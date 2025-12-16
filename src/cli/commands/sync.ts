import chalk from "chalk";
import ora from "ora";
import cliProgress from "cli-progress";
import { loadConfig } from "../../config/configManager.js";
import { downloadVideo, type VideoDownloadTask, type DownloadResult } from "../../downloader/index.js";
import { getAuthenticatedSession } from "../../scraper/auth.js";
import { extractLessonContent, formatMarkdown } from "../../scraper/extractor.js";
import { buildCourseStructure } from "../../scraper/navigator.js";
import {
  createCourseDirectory,
  createLessonDirectory,
  createModuleDirectory,
  getVideoPath,
  isLessonSynced,
  saveLessonMetadata,
  saveMarkdown,
} from "../../storage/fileSystem.js";

/**
 * Format bytes to human readable string.
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

const SKOOL_DOMAIN = "www.skool.com";
const SKOOL_LOGIN_URL = "https://www.skool.com/login";

interface SyncOptions {
  skipVideos?: boolean;
  skipContent?: boolean;
  dryRun?: boolean;
  limit?: number;
}

interface LessonTask {
  moduleIndex: number;
  moduleName: string;
  lessonIndex: number;
  lessonName: string;
  lessonUrl: string;
  lessonDir: string;
}

/**
 * Handles the sync command.
 * Downloads all content from a Skool course.
 */
export async function syncCommand(url: string, options: SyncOptions): Promise<void> {
  console.log(chalk.blue("\n📚 Course Sync\n"));

  // Validate URL
  if (!url.includes("skool.com")) {
    console.log(chalk.red("❌ Invalid URL. Please provide a Skool URL."));
    console.log(chalk.gray("   Example: https://www.skool.com/your-community/classroom\n"));
    process.exit(1);
  }

  // Ensure URL points to classroom
  if (!url.includes("/classroom")) {
    url = url.replace(/\/?$/, "/classroom");
  }

  const config = loadConfig();

  // Get authenticated session
  const spinner = ora("Connecting to Skool...").start();

  let browser;
  let session;

  try {
    const result = await getAuthenticatedSession(SKOOL_DOMAIN, SKOOL_LOGIN_URL, {
      headless: config.headless,
      fastMode: true,  // Skip images, fonts, CSS for faster scraping
    });
    browser = result.browser;
    session = result.session;
    spinner.succeed("Connected to Skool");
  } catch (error) {
    spinner.fail("Failed to connect");
    console.log(chalk.red("\n❌ Authentication failed. Please run: course-grab login\n"));
    process.exit(1);
  }

  try {
    // Build course structure
    const structureSpinner = ora("Scanning course structure...").start();
    const courseStructure = await buildCourseStructure(session.page, url);
    structureSpinner.succeed(
      `Found ${courseStructure.modules.length} modules with ${courseStructure.modules.reduce((sum, m) => sum + m.lessons.length, 0)} lessons`
    );

    if (options.dryRun) {
      console.log(chalk.cyan("\n📋 Dry Run - Would download:\n"));
      printCourseStructure(courseStructure);
      await browser.close();
      return;
    }

    // Create output directory
    const courseDir = createCourseDirectory(config.outputDir, courseStructure.name);
    console.log(chalk.gray(`\n📁 Output: ${courseDir}\n`));

    // Build task list for all lessons
    const lessonTasks: LessonTask[] = [];
    const videoTasks: VideoDownloadTask[] = [];

    for (let moduleIndex = 0; moduleIndex < courseStructure.modules.length; moduleIndex++) {
      const module = courseStructure.modules[moduleIndex];
      if (!module) continue;

      const moduleDir = createModuleDirectory(courseDir, moduleIndex, module.name);

      for (let lessonIndex = 0; lessonIndex < module.lessons.length; lessonIndex++) {
        const lesson = module.lessons[lessonIndex];
        if (!lesson) continue;

        const lessonDir = createLessonDirectory(moduleDir, lessonIndex, lesson.name);

        lessonTasks.push({
          moduleIndex,
          moduleName: module.name,
          lessonIndex,
          lessonName: lesson.name,
          lessonUrl: lesson.url,
          lessonDir,
        });

        // Check limit
        if (options.limit && lessonTasks.length >= options.limit) {
          break;
        }
      }

      // Check limit for outer loop too
      if (options.limit && lessonTasks.length >= options.limit) {
        break;
      }
    }

    // Phase 1: Extract content from all lessons
    console.log(chalk.blue("\n📝 Phase 1: Extracting content...\n"));

    let currentModule = "";
    let contentExtracted = 0;
    let contentSkipped = 0;
    let contentFailed = 0;

    for (const task of lessonTasks) {
      // Print module header when it changes
      if (task.moduleName !== currentModule) {
        currentModule = task.moduleName;
        console.log(chalk.blue(`\n📖 ${currentModule}`));
      }

      const syncStatus = isLessonSynced(task.lessonDir);

      // Check what needs to be done
      const needsContent = !options.skipContent && !syncStatus.content;
      const needsVideo = !options.skipVideos && !syncStatus.video;

      // Skip if everything is cached
      if (!needsContent && !needsVideo) {
        console.log(chalk.gray(`   ✓ ${task.lessonName} (cached)`));
        contentSkipped++;
        continue;
      }

      const lessonSpinner = ora(`   ${task.lessonName}`).start();

      try {
        // Always extract content to get video URL
        const content = await extractLessonContent(session.page, task.lessonUrl);

        // Check if locked
        if (content.isLocked) {
          lessonSpinner.warn(`   ${task.lessonName} (locked - no access)`);
          contentSkipped++;
          continue;
        }

        // Save markdown content if needed
        if (needsContent) {
          const markdown = formatMarkdown(
            content.title,
            content.markdownContent,
            content.videoUrl,
            content.videoType,
            content.updatedAt
          );
          saveMarkdown(task.lessonDir, "content.md", markdown);

          // Save metadata for incremental sync
          saveLessonMetadata(task.lessonDir, {
            syncedAt: new Date().toISOString(),
            updatedAt: content.updatedAt,
            videoUrl: content.videoUrl,
            videoType: content.videoType,
          });
        }

        // Queue video for download if needed
        if (needsVideo && content.videoUrl && content.videoType) {
          videoTasks.push({
            lessonName: task.lessonName,
            videoUrl: content.videoUrl,
            videoType: content.videoType,
            outputPath: getVideoPath(task.lessonDir),
          });
          lessonSpinner.succeed(`   ${task.lessonName} (video queued)`);
        } else {
          lessonSpinner.succeed(`   ${task.lessonName}`);
        }

        contentExtracted++;
      } catch (error) {
        lessonSpinner.fail(`   ${task.lessonName}`);
        console.log(chalk.red(`      Error: ${error}`));
        contentFailed++;
      }
    }

    console.log(chalk.gray(`\n   Content: ${contentExtracted} extracted, ${contentSkipped} cached, ${contentFailed} failed`));

    // Phase 2: Download videos
    if (!options.skipVideos && videoTasks.length > 0) {
      console.log(chalk.blue(`\n🎬 Phase 2: Downloading ${videoTasks.length} videos...\n`));

      const downloadErrors: Array<{ name: string; error: string }> = [];
      let completedDownloads = 0;
      let totalBytes = 0;

      // Process videos with controlled parallelism
      const videoConcurrency = config.concurrency;
      console.log(chalk.gray(`   (${videoConcurrency} parallel downloads, 8 parallel segments per video)\n`));

      // Track progress for each active download
      const activeDownloads = new Map<string, { bar: cliProgress.SingleBar; name: string }>();

      const multibar = new cliProgress.MultiBar({
        clearOnComplete: false,
        hideCursor: true,
        format: chalk.cyan("   {bar}") + " | {percentage}% | {phase} | {name}",
        barCompleteChar: "█",
        barIncompleteChar: "░",
        linewrap: false,
      }, cliProgress.Presets.shades_grey);

      // Process in batches
      for (let i = 0; i < videoTasks.length; i += videoConcurrency) {
        const batch = videoTasks.slice(i, i + videoConcurrency);

        const batchPromises = batch.map(async (task) => {
          const shortName = task.lessonName.length > 40
            ? task.lessonName.substring(0, 37) + "..."
            : task.lessonName;

          const bar = multibar.create(100, 0, { name: shortName, phase: "start" });
          activeDownloads.set(task.lessonName, { bar, name: shortName });

          try {
            const result: DownloadResult = await downloadVideo(task, (progress) => {
              bar.update(Math.round(progress.percent), {
                phase: progress.phase ?? "dl"
              });
            });

            multibar.remove(bar);
            activeDownloads.delete(task.lessonName);

            if (result.success) {
              completedDownloads++;
              if (result.fileSize) {
                totalBytes += result.fileSize;
              }
              return { success: true, name: shortName, size: result.fileSize };
            } else {
              downloadErrors.push({ name: task.lessonName, error: result.error ?? "Unknown error" });
              return { success: false, name: shortName, error: result.error };
            }
          } catch (error) {
            multibar.remove(bar);
            activeDownloads.delete(task.lessonName);
            const errMsg = error instanceof Error ? error.message : String(error);
            downloadErrors.push({ name: task.lessonName, error: errMsg });
            return { success: false, name: shortName, error: errMsg };
          }
        });

        const results = await Promise.all(batchPromises);

        // Log batch results
        for (const result of results) {
          if (result.success) {
            console.log(chalk.green(`   ✓ ${result.name} (${result.size ? formatBytes(result.size) : "done"})`));
          } else {
            console.log(chalk.red(`   ✗ ${result.name}: ${result.error}`));
          }
        }
      }

      multibar.stop();

      // Summary
      console.log();
      if (completedDownloads > 0) {
        console.log(chalk.green(`   ✓ ${completedDownloads} videos downloaded (${formatBytes(totalBytes)})`));
      }
      if (downloadErrors.length > 0) {
        console.log(chalk.red(`   ✗ ${downloadErrors.length} failed:`));
        for (const err of downloadErrors) {
          console.log(chalk.red(`     - ${err.name}: ${err.error}`));
        }
      }
    }

    // Summary
    const totalLessons = lessonTasks.length;
    console.log(chalk.green("\n✅ Sync complete!\n"));
    console.log(chalk.gray(`   Total lessons: ${totalLessons}`));
    console.log(chalk.gray(`   Content extracted: ${contentExtracted}`));
    console.log(chalk.gray(`   Videos queued: ${videoTasks.length}`));
    console.log(chalk.gray(`   Output: ${courseDir}\n`));
  } finally {
    await browser.close();
  }
}

interface CourseStructure {
  name: string;
  modules: Array<{
    name: string;
    lessons: Array<{ name: string }>;
  }>;
}

function printCourseStructure(course: CourseStructure): void {
  console.log(chalk.white(`📚 ${course.name}\n`));

  for (const module of course.modules) {
    console.log(chalk.blue(`   📖 ${module.name}`));
    for (const lesson of module.lessons) {
      console.log(chalk.gray(`      - ${lesson.name}`));
    }
  }
  console.log();
}
