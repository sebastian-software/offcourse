import chalk from "chalk";
import cliProgress from "cli-progress";
import ora from "ora";
import { writeFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { loadConfig } from "../../config/configManager.js";
import {
  downloadVideo,
  type VideoDownloadTask,
  validateVideoHls,
} from "../../downloader/index.js";
import { getAuthenticatedSession } from "../../scraper/auth.js";
import { extractLessonContent, formatMarkdown, extractVideoUrl } from "../../scraper/extractor.js";
import { buildCourseStructure } from "../../scraper/navigator.js";
import {
  createCourseDirectory,
  createModuleDirectory,
  downloadFile,
  getDownloadFilePath,
  getMarkdownPath,
  getVideoPath,
  isLessonSynced,
  saveMarkdown,
} from "../../storage/fileSystem.js";
import {
  CourseDatabase,
  extractCommunitySlug,
  LessonStatus,
  type LessonWithModule,
} from "../../state/index.js";

/**
 * Tracks if shutdown has been requested (Ctrl+C).
 */
let isShuttingDown = false;

/**
 * Resources to clean up on shutdown.
 */
interface CleanupResources {
  browser?: import("playwright").Browser;
  db?: CourseDatabase;
}

const cleanupResources: CleanupResources = {};

/**
 * Graceful shutdown handler.
 */
function setupShutdownHandlers(): void {
  const shutdown = async (signal: string) => {
    if (isShuttingDown) {
      // Force exit on second signal
      console.log(chalk.red("\n\n⚠️  Force exit"));
      process.exit(1);
    }

    isShuttingDown = true;
    console.log(chalk.yellow(`\n\n⏹️  ${signal} received, shutting down gracefully...`));

    try {
      if (cleanupResources.browser) {
        await cleanupResources.browser.close();
      }
      if (cleanupResources.db) {
        cleanupResources.db.close();
      }
      console.log(chalk.gray("   Cleanup complete. State saved."));
    } catch (error) {
      // Ignore cleanup errors during shutdown
    }

    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

/**
 * Check if we should continue processing or stop due to shutdown.
 */
function shouldContinue(): boolean {
  return !isShuttingDown;
}

interface DownloadAttempt {
  lessonName: string;
  videoUrl: string;
  videoType: string | null;
  success: boolean;
  error?: string | undefined;
  errorCode?: string | undefined;
  details?: string | undefined;
  timestamp: string;
}

const SKOOL_DOMAIN = "www.skool.com";
const SKOOL_LOGIN_URL = "https://www.skool.com/login";

interface SyncOptions {
  skipVideos?: boolean;
  skipContent?: boolean;
  dryRun?: boolean;
  limit?: number;
  force?: boolean;
  retryErrors?: boolean;
  resume?: boolean;
}

/**
 * Handles the sync command.
 * Downloads all content from a Skool course with incremental state tracking.
 */
export async function syncCommand(url: string, options: SyncOptions): Promise<void> {
  // Setup graceful shutdown handlers
  setupShutdownHandlers();

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
  const communitySlug = extractCommunitySlug(url);

  // Initialize database
  const db = new CourseDatabase(communitySlug);
  cleanupResources.db = db;
  console.log(chalk.gray(`   State: ~/.offcourse/cache/${communitySlug}.db`));

  // Reset error lessons if requested (--retry-errors or --force)
  if (options.retryErrors || options.force) {
    // In resume mode, reset to 'validated' so they can be downloaded directly
    // Otherwise reset to 'pending' so they go through validation again
    const resetCount = options.resume
      ? db.resetErrorLessonsForResume()
      : db.resetErrorLessons();
    if (resetCount > 0) {
      console.log(chalk.yellow(`   Reset ${resetCount} error lessons for retry`));
    }
  }

  // Check existing state
  const existingMeta = db.getCourseMetadata();
  const hasExistingData = existingMeta.totalLessons > 0;

  if (hasExistingData && !options.force) {
    const summary = db.getStatusSummary();
    console.log(chalk.gray(`   Existing: ${existingMeta.totalModules} modules, ${existingMeta.totalLessons} lessons`));
    const lockedInfo = summary.locked > 0 ? `, ${summary.locked} locked` : "";
    console.log(chalk.gray(`   Status: ${summary.downloaded} downloaded, ${summary.validated} ready, ${summary.error} failed, ${summary.pending} not scanned${lockedInfo}`));
  }

  // Get authenticated session
  const spinner = ora("Connecting to Skool...").start();

  let browser;
  let session;

  try {
    const result = await getAuthenticatedSession(SKOOL_DOMAIN, SKOOL_LOGIN_URL, {
      headless: config.headless,
    });
    browser = result.browser;
    session = result.session;
    cleanupResources.browser = browser;
    spinner.succeed("Connected to Skool");
  } catch (error) {
    spinner.fail("Failed to connect");
    db.close();
    console.log(chalk.red("\n❌ Authentication failed. Please run: offcourse login\n"));
    process.exit(1);
  }

  try {
    // Check if shutdown was requested during connection
    if (!shouldContinue()) {
      return;
    }

    // Create output directory (use URL slug for consistency)
    const courseDir = createCourseDirectory(config.outputDir, communitySlug);

    // Resume mode: skip scanning and validation, just download
    if (options.resume) {
      console.log(chalk.yellow("\n⏩ Resume mode: skipping scan and validation\n"));
      console.log(chalk.gray(`📁 Output: ${courseDir}\n`));

      // Warn about unscanned lessons
      const summary = db.getStatusSummary();
      if (summary.pending > 0) {
        console.log(chalk.yellow(`   ⚠️  ${summary.pending} lessons have not been scanned yet.`));
        console.log(chalk.gray(`   Run without --resume to scan them first.\n`));
      }

      // Build download tasks from validated lessons in DB
      const videoTasks = await buildDownloadTasksFromDb(db, courseDir);

      if (videoTasks.length === 0) {
        console.log(chalk.gray("   No videos ready for download"));
        printStatusSummary(db);
      } else {
        await downloadVideos(db, videoTasks, courseDir, config);
        printStatusSummary(db);
        console.log(chalk.green("\n✅ Resume complete!\n"));
      }

      console.log(chalk.gray(`   Output: ${courseDir}\n`));
      return;
    }

    // Phase 1: Scan course structure and update database
    await scanCourseStructure(session.page, url, db, options);

    if (options.dryRun) {
      printStatusSummary(db);
      await browser.close();
      db.close();
      return;
    }

    console.log(chalk.gray(`\n📁 Output: ${courseDir}\n`));

    // Phase 2: Validate videos and get HLS URLs
    await validateVideos(session.page, db, options);

    // Phase 3: Extract content and queue downloads
    const videoTasks = await extractContentAndQueueVideos(session.page, db, courseDir, options);

    // Phase 4: Download videos
    if (!options.skipVideos && videoTasks.length > 0) {
      await downloadVideos(db, videoTasks, courseDir, config);
    }

    // Summary
    printStatusSummary(db);
    console.log(chalk.green("\n✅ Sync complete!\n"));
    console.log(chalk.gray(`   Output: ${courseDir}\n`));
  } finally {
    await browser.close();
    db.close();
  }
}

/**
 * Phase 1: Scan course structure and populate database.
 */
async function scanCourseStructure(
  page: import("playwright").Page,
  url: string,
  db: CourseDatabase,
  options: SyncOptions
): Promise<void> {
  console.log(chalk.blue("\n📚 Phase 1: Scanning course structure...\n"));

  let progressBar: cliProgress.SingleBar | undefined;
  let courseName = "";
  let totalModules = 0;
  let lockedModules = 0;

  try {
    const courseStructure = await buildCourseStructure(page, url, (progress) => {
      if (progress.phase === "init" && progress.courseName) {
        courseName = progress.courseName;
        console.log(chalk.white(`   Course: ${courseName}\n`));
      } else if (progress.phase === "modules" && progress.totalModules) {
        totalModules = progress.totalModules;
        progressBar = new cliProgress.SingleBar({
          format: "   {bar} {percentage}% | {value}/{total} | {status}",
          barCompleteChar: "█",
          barIncompleteChar: "░",
          barsize: 30,
          hideCursor: true,
        }, cliProgress.Presets.shades_grey);
        progressBar.start(totalModules, 0, { status: "Starting..." });
      } else if (progress.phase === "lessons" && progress.currentModule !== undefined) {
        if (progress.skippedLocked) {
          lockedModules++;
          progressBar?.increment({ status: `🔒 ${progress.currentModule}` });
        } else if (progress.lessonsFound !== undefined) {
          progressBar?.increment({
            status: `${progress.currentModule} (${progress.lessonsFound} lessons)`
          });
        } else {
          const shortName = progress.currentModule.length > 35
            ? progress.currentModule.substring(0, 32) + "..."
            : progress.currentModule;
          progressBar?.update(progress.currentModuleIndex ?? 0, { status: shortName });
        }
      } else if (progress.phase === "done") {
        progressBar?.stop();
      }
    });

    // Update metadata
    db.updateCourseMetadata(courseStructure.name, courseStructure.url);

    // Track new lessons found
    let newModules = 0;
    let newLessons = 0;

    for (let moduleIndex = 0; moduleIndex < courseStructure.modules.length; moduleIndex++) {
      const module = courseStructure.modules[moduleIndex];
      if (!module) continue;

      // Check if module exists
      const existingModule = db.getModuleBySlug(module.slug);
      const moduleRecord = db.upsertModule(module.slug, module.name, moduleIndex, module.isLocked);

      if (!existingModule) {
        newModules++;
      }

      for (let lessonIndex = 0; lessonIndex < module.lessons.length; lessonIndex++) {
        const lesson = module.lessons[lessonIndex];
        if (!lesson) continue;

        // Check if lesson exists
        const existingLesson = db.getLessonByUrl(lesson.url);
        db.upsertLesson(moduleRecord.id, lesson.slug, lesson.name, lesson.url, lessonIndex, lesson.isLocked);

        if (!existingLesson) {
          newLessons++;
        }

        // Check limit
        if (options.limit && db.getLessonCount() >= options.limit) {
          break;
        }
      }

      if (options.limit && db.getLessonCount() >= options.limit) {
        break;
      }
    }

    const meta = db.getCourseMetadata();
    console.log();
    const parts: string[] = [];
    parts.push(`${meta.totalModules} modules`);
    parts.push(`${meta.totalLessons} lessons`);
    if (lockedModules > 0) parts.push(chalk.yellow(`${lockedModules} locked`));
    if (newLessons > 0) parts.push(chalk.green(`+${newLessons} new`));
    console.log(`   Found: ${parts.join(", ")}`);
  } catch (error) {
    progressBar?.stop();
    console.log(chalk.red("   Failed to scan course structure"));
    throw error;
  }
}

/**
 * Phase 2: Validate videos and get HLS URLs.
 */
async function validateVideos(
  page: import("playwright").Page,
  db: CourseDatabase,
  _options: SyncOptions
): Promise<void> {
  // Get lessons that need scanning
  const lessonsToScan = db.getLessonsToScan();

  if (lessonsToScan.length === 0) {
    console.log(chalk.gray("   No new lessons to validate"));
    return;
  }

  console.log(chalk.blue(`\n🔍 Phase 2: Validating ${lessonsToScan.length} videos...\n`));

  // Create progress bar
  const progressBar = new cliProgress.SingleBar({
    format: "   {bar} {percentage}% | {value}/{total} | {status}",
    barCompleteChar: "█",
    barIncompleteChar: "░",
    barsize: 30,
    hideCursor: true,
  }, cliProgress.Presets.shades_grey);

  progressBar.start(lessonsToScan.length, 0, { status: "Starting..." });

  let validated = 0;
  let errors = 0;
  let skipped = 0;
  let currentModule = "";
  let processed = 0;

  for (const lesson of lessonsToScan) {
    // Check for graceful shutdown
    if (!shouldContinue()) {
      progressBar.stop();
      console.log(chalk.yellow("\n   Stopping validation (shutdown requested)"));
      break;
    }

    // Update module in status
    if (lesson.moduleName !== currentModule) {
      currentModule = lesson.moduleName;
    }

    // Update progress bar with current lesson
    const shortName = lesson.name.length > 40 ? lesson.name.substring(0, 37) + "..." : lesson.name;
    progressBar.update(processed, { status: shortName });

    try {
      // Navigate to lesson and extract video URL
      await page.goto(lesson.url, { timeout: 30000 });
      await page.waitForLoadState("domcontentloaded");
      // Wait for iframes to potentially load (Skool lazy-loads video iframes)
      try {
        await page.waitForSelector('iframe[src*="loom.com"], iframe[src*="vimeo"], iframe[src*="youtube"], video', {
          timeout: 3000,
        });
      } catch {
        // No video element appeared - might not have one, will check below
      }
      await page.waitForTimeout(500);

      const { url: videoUrl, type: videoType } = await extractVideoUrl(page);

      if (!videoUrl || !videoType) {
        // No video on this lesson
        db.updateLessonScan(lesson.id, null, null, null, LessonStatus.SKIPPED);
        skipped++;
      } else if (videoType === "youtube" || videoType === "wistia") {
        // Handle unsupported video types
        db.updateLessonScan(
          lesson.id,
          videoType,
          videoUrl,
          null,
          LessonStatus.ERROR,
          `${videoType.charAt(0).toUpperCase() + videoType.slice(1)} videos are not yet supported`,
          "UNSUPPORTED_PROVIDER"
        );
        errors++;
      } else if (videoType === "loom" || videoType === "vimeo") {
        // Validate HLS for video types that support it
        if (page.url() !== lesson.url) {
          await page.goto(lesson.url, { timeout: 30000 });
          await page.waitForLoadState("domcontentloaded");
          await page.waitForTimeout(1000);
        }

        const validation = await validateVideoHls(videoUrl, videoType, page, lesson.url);

        if (validation.isValid) {
          db.updateLessonScan(lesson.id, videoType, videoUrl, validation.hlsUrl, LessonStatus.VALIDATED);
          validated++;
        } else {
          db.updateLessonScan(lesson.id, videoType, videoUrl, null, LessonStatus.ERROR, validation.error, validation.errorCode);
          errors++;
        }
      } else {
        // For native/unknown video types, mark as validated
        db.updateLessonScan(lesson.id, videoType, videoUrl, null, LessonStatus.VALIDATED);
        validated++;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      db.updateLessonScan(lesson.id, null, null, null, LessonStatus.ERROR, errorMessage, "SCAN_ERROR");
      errors++;
    }

    processed++;
    progressBar.update(processed, { status: shortName });
  }

  progressBar.stop();

  // Print summary
  console.log();
  const parts: string[] = [];
  if (validated > 0) parts.push(chalk.green(`${validated} ready`));
  if (skipped > 0) parts.push(chalk.gray(`${skipped} no video`));
  if (errors > 0) parts.push(chalk.red(`${errors} errors`));
  console.log(`   Validation: ${parts.join(", ")}`);
}

/**
 * Phase 3: Extract content and queue video downloads.
 */
async function extractContentAndQueueVideos(
  page: import("playwright").Page,
  db: CourseDatabase,
  courseDir: string,
  options: SyncOptions
): Promise<VideoDownloadTask[]> {
  // Get lessons ready for download
  const lessonsToProcess = db.getLessonsByStatus(LessonStatus.VALIDATED);

  if (lessonsToProcess.length === 0) {
    console.log(chalk.gray("   No videos ready for download"));
    return [];
  }

  console.log(chalk.blue(`\n📝 Phase 3: Extracting content for ${lessonsToProcess.length} lessons...\n`));

  // Create progress bar
  const progressBar = new cliProgress.SingleBar({
    format: "   {bar} {percentage}% | {value}/{total} | {status}",
    barCompleteChar: "█",
    barIncompleteChar: "░",
    barsize: 30,
    hideCursor: true,
  }, cliProgress.Presets.shades_grey);

  progressBar.start(lessonsToProcess.length, 0, { status: "Starting..." });

  const videoTasks: VideoDownloadTask[] = [];
  let contentExtracted = 0;
  let contentSkipped = 0;
  let filesDownloadedTotal = 0;
  let processed = 0;

  // Group lessons by module for directory creation
  const lessonsByModule = new Map<string, LessonWithModule[]>();
  for (const lesson of lessonsToProcess) {
    const key = `${lesson.modulePosition}-${lesson.moduleSlug}`;
    if (!lessonsByModule.has(key)) {
      lessonsByModule.set(key, []);
    }
    lessonsByModule.get(key)!.push(lesson);
  }

  for (const [_moduleKey, lessons] of lessonsByModule) {
    // Check for graceful shutdown
    if (!shouldContinue()) {
      progressBar.stop();
      console.log(chalk.yellow("\n   Stopping content extraction (shutdown requested)"));
      break;
    }

    const firstLesson = lessons[0]!;
    const moduleDir = createModuleDirectory(courseDir, firstLesson.modulePosition, firstLesson.moduleName);

    for (const lesson of lessons) {
      // Check for graceful shutdown
      if (!shouldContinue()) {
        break;
      }

      const shortName = lesson.name.length > 40 ? lesson.name.substring(0, 37) + "..." : lesson.name;
      progressBar.update(processed, { status: shortName });

      const syncStatus = isLessonSynced(moduleDir, lesson.position, lesson.name);

      // Check if content already exists
      if (!options.skipContent && !syncStatus.content) {
        try {
          const content = await extractLessonContent(page, lesson.url);
          const markdown = formatMarkdown(
            content.title,
            content.markdownContent,
            lesson.videoUrl,
            lesson.videoType
          );
          const mdPath = getMarkdownPath(moduleDir, lesson.position, lesson.name);
          saveMarkdown(dirname(mdPath), basename(mdPath), markdown);

          // Download any linked files (PDFs, Office documents, etc.)
          if (content.downloadableFiles.length > 0) {
            for (const file of content.downloadableFiles) {
              const filePath = getDownloadFilePath(
                moduleDir,
                lesson.position,
                lesson.name,
                file.filename
              );
              const result = await downloadFile(file.url, filePath);
              if (result.success) {
                filesDownloadedTotal++;
              }
            }
          }
          contentExtracted++;
        } catch {
          // Error extracting content, continue with next lesson
        }
      } else {
        contentSkipped++;
      }

      // Queue video for download if not already downloaded
      if (!options.skipVideos && !syncStatus.video && lesson.videoUrl && lesson.videoType) {
        videoTasks.push({
          lessonId: lesson.id,
          lessonName: lesson.name,
          videoUrl: lesson.hlsUrl ?? lesson.videoUrl,
          videoType: lesson.videoType as VideoDownloadTask["videoType"],
          outputPath: getVideoPath(moduleDir, lesson.position, lesson.name),
        });
      }

      processed++;
      progressBar.update(processed, { status: shortName });
    }
  }

  progressBar.stop();

  // Print summary
  console.log();
  const parts: string[] = [];
  if (contentExtracted > 0) parts.push(chalk.green(`${contentExtracted} extracted`));
  if (contentSkipped > 0) parts.push(chalk.gray(`${contentSkipped} cached`));
  if (filesDownloadedTotal > 0) parts.push(chalk.blue(`${filesDownloadedTotal} files`));
  console.log(`   Content: ${parts.join(", ")}`);

  return videoTasks;
}

/**
 * Phase 4: Download videos with multi-progress display.
 */
async function downloadVideos(
  db: CourseDatabase,
  videoTasks: VideoDownloadTask[],
  courseDir: string,
  config: { concurrency: number; retryAttempts: number },
  _options?: SyncOptions
): Promise<void> {
  const total = videoTasks.length;
  console.log(chalk.blue(`\n🎬 Phase 4: Downloading ${total} videos...\n`));

  // Create multi-bar container with auto-clear
  const multibar = new cliProgress.MultiBar({
    clearOnComplete: true,
    hideCursor: true,
    format: "   {typeTag} {bar} {percentage}% | {lessonName}",
    barCompleteChar: "█",
    barIncompleteChar: "░",
    barsize: 25,
    autopadding: true,
  }, cliProgress.Presets.shades_grey);

  // Overall progress bar at the top
  const overallBar = multibar.create(total, 0, {
    typeTag: "[TOTAL]".padEnd(8),
    lessonName: `0/${total} completed`
  });

  // Track results
  const downloadAttempts: DownloadAttempt[] = [];
  const errors: Array<{ id: string; error: string }> = [];
  let completed = 0;
  let failed = 0;

  // Active downloads map: lessonName -> bar
  const activeBars = new Map<string, cliProgress.SingleBar>();

  // Process downloads with controlled concurrency
  const taskQueue = [...videoTasks];
  const activePromises = new Set<Promise<void>>();

  const processTask = async (task: VideoDownloadTask): Promise<void> => {
    const typeTag = task.videoType ? `[${task.videoType.toUpperCase()}]` : "[VIDEO]";
    const shortName = task.lessonName.length > 40
      ? task.lessonName.substring(0, 37) + "..."
      : task.lessonName;

    // Create progress bar for this download
    const bar = multibar.create(100, 0, {
      typeTag: typeTag.padEnd(8),
      lessonName: shortName,
    });
    activeBars.set(task.lessonName, bar);

    try {
      const downloadResult = await downloadVideo(task, (progress) => {
        bar.update(Math.round(progress.percent));
      });

      // Record the attempt
      const attempt: DownloadAttempt = {
        lessonName: task.lessonName,
        videoUrl: task.videoUrl,
        videoType: task.videoType,
        success: downloadResult.success,
        timestamp: new Date().toISOString(),
      };

      if (!downloadResult.success) {
        attempt.error = downloadResult.error;
        attempt.errorCode = downloadResult.errorCode;
        attempt.details = downloadResult.details;

        db.markLessonError(task.lessonId, downloadResult.error ?? "Download failed", downloadResult.errorCode);

        errors.push({
          id: task.lessonName,
          error: downloadResult.error ?? "Download failed",
        });
        failed++;
      } else {
        // Update database with success
        try {
          const stats = statSync(task.outputPath);
          db.markLessonDownloaded(task.lessonId, stats.size);
        } catch {
          db.markLessonDownloaded(task.lessonId);
        }
        completed++;
      }

      downloadAttempts.push(attempt);
    } catch (error) {
      failed++;
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push({ id: task.lessonName, error: errorMsg });
      db.markLessonError(task.lessonId, errorMsg);
    } finally {
      // Remove the bar when done (key fix!)
      multibar.remove(bar);
      activeBars.delete(task.lessonName);

      // Update overall progress
      const done = completed + failed;
      overallBar.update(done, {
        lessonName: `${done}/${total} completed (${failed} failed)`
      });
    }
  };

  // Run downloads with controlled concurrency
  while (taskQueue.length > 0 || activePromises.size > 0) {
    // Start new downloads up to concurrency limit
    while (taskQueue.length > 0 && activePromises.size < config.concurrency) {
      const task = taskQueue.shift();
      if (task) {
        const promise = processTask(task).finally(() => {
          activePromises.delete(promise);
        });
        activePromises.add(promise);
      }
    }

    // Wait for at least one to complete
    if (activePromises.size > 0) {
      await Promise.race(activePromises);
    }
  }

  // Stop multibar
  multibar.stop();

  // Print summary
  console.log();
  if (failed === 0) {
    console.log(chalk.green(`   ✓ ${completed} videos downloaded successfully`));
  } else {
    console.log(chalk.yellow(`   Videos: ${completed} downloaded, ${failed} failed`));
  }

  if (errors.length > 0) {
    console.log(chalk.yellow("\n   Failed downloads:"));
    for (const error of errors) {
      const task = videoTasks.find((t) => t.lessonName === error.id);
      const typeTag = task?.videoType ? `[${task.videoType.toUpperCase()}]` : "";
      console.log(chalk.red(`   - ${typeTag} ${error.id}: ${error.error}`));
    }

    // Save diagnostic log
    const failedAttempts = downloadAttempts.filter((a) => !a.success);
    if (failedAttempts.length > 0) {
      const logPath = join(courseDir, `download-errors-${Date.now()}.json`);
      const logData = {
        timestamp: new Date().toISOString(),
        totalAttempts: videoTasks.length,
        successful: completed,
        failed,
        concurrency: config.concurrency,
        retryAttempts: config.retryAttempts,
        failures: failedAttempts,
      };
      writeFileSync(logPath, JSON.stringify(logData, null, 2));
      console.log(chalk.gray(`\n   📋 Detailed error log saved: ${logPath}`));
    }
  }
}

/**
 * Build download tasks from database (for --resume mode).
 * Skips lessons that are already downloaded.
 */
async function buildDownloadTasksFromDb(
  db: CourseDatabase,
  courseDir: string
): Promise<VideoDownloadTask[]> {
  const lessons = db.getLessonsToDownload();
  const videoTasks: VideoDownloadTask[] = [];
  let alreadyOnDisk = 0;

  console.log(chalk.blue(`\n📦 Building download list from ${lessons.length} ready lessons...\n`));

  for (const lesson of lessons) {
    // Create module directory (flat structure - no lesson subdirectories)
    const moduleDir = createModuleDirectory(
      courseDir,
      lesson.modulePosition,
      lesson.moduleName
    );

    // Check if already downloaded
    const syncStatus = isLessonSynced(moduleDir, lesson.position, lesson.name);
    if (syncStatus.video) {
      // File exists on disk but DB not updated - fix DB state
      db.markLessonDownloaded(lesson.id);
      alreadyOnDisk++;
      continue;
    }

    if (lesson.hlsUrl && lesson.videoType) {
      videoTasks.push({
        lessonId: lesson.id,
        lessonName: lesson.name,
        videoUrl: lesson.hlsUrl,
        videoType: lesson.videoType as VideoDownloadTask["videoType"],
        outputPath: getVideoPath(moduleDir, lesson.position, lesson.name),
      });
    }
  }

  if (alreadyOnDisk > 0) {
    console.log(chalk.green(`   ✅ ${alreadyOnDisk} already on disk (DB updated)`));
  }
  console.log(chalk.gray(`   ⬇️  ${videoTasks.length} videos to download`));
  return videoTasks;
}

/**
 * Print status summary from database.
 */
function printStatusSummary(db: CourseDatabase): void {
  const meta = db.getCourseMetadata();
  const summary = db.getStatusSummary();
  const videoTypes = db.getVideoTypeSummary();

  console.log(chalk.cyan("\n📊 Status Summary\n"));
  console.log(chalk.white(`   Course: ${meta.name}`));
  console.log(chalk.gray(`   Modules: ${meta.totalModules}`));
  console.log(chalk.gray(`   Lessons: ${meta.totalLessons}`));
  console.log();
  
  // Clear status labels
  console.log(chalk.green(`   ✅ Downloaded:        ${summary.downloaded}`));
  if (summary.validated > 0) {
    console.log(chalk.blue(`   ⬇️  Ready to download: ${summary.validated}`));
  }
  if (summary.pending > 0) {
    console.log(chalk.gray(`   🔍 Not scanned yet:   ${summary.pending}`));
  }
  if (summary.skipped > 0) {
    console.log(chalk.gray(`   ➖ No video:          ${summary.skipped}`));
  }
  if (summary.locked > 0) {
    console.log(chalk.yellow(`   🔒 Locked:            ${summary.locked}`));
  }

  if (summary.error > 0) {
    console.log(chalk.red(`   ❌ Failed:            ${summary.error}`));

    // Show unsupported providers if any
    const unsupported = db.getLessonsByErrorCode("UNSUPPORTED_PROVIDER");
    if (unsupported.length > 0) {
      console.log(chalk.yellow(`\n   ⚠ Unsupported video providers:`));

      // Group by video type
      const byType = new Map<string, typeof unsupported>();
      for (const lesson of unsupported) {
        const type = lesson.videoType ?? "unknown";
        if (!byType.has(type)) {
          byType.set(type, []);
        }
        byType.get(type)!.push(lesson);
      }

      for (const [type, lessons] of byType) {
        console.log(chalk.yellow(`     ${type.toUpperCase()}: ${lessons.length} video(s)`));
        for (const lesson of lessons.slice(0, 3)) {
          console.log(chalk.gray(`       - ${lesson.moduleName} → ${lesson.name}`));
        }
        if (lessons.length > 3) {
          console.log(chalk.gray(`       ... and ${lessons.length - 3} more`));
        }
      }
      console.log(chalk.gray(`\n   💡 Tip: Install yt-dlp to download YouTube/Wistia videos`));
    }
  }

  // Show video type breakdown
  if (Object.keys(videoTypes).length > 0) {
    console.log(chalk.gray(`\n   Video types found:`));
    for (const [type, count] of Object.entries(videoTypes)) {
      const supported = type === "loom" || type === "vimeo" || type === "native";
      const icon = supported ? "✓" : "✗";
      const color = supported ? chalk.green : chalk.yellow;
      console.log(color(`     ${icon} ${type}: ${count}`));
    }
  }
}
