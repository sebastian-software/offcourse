import chalk from "chalk";
import ora from "ora";
import { writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../../config/configManager.js";
import {
  downloadVideo,
  AsyncQueue,
  type VideoDownloadTask,
  validateVideoHls,
} from "../../downloader/index.js";
import { getAuthenticatedSession } from "../../scraper/auth.js";
import { extractLessonContent, formatMarkdown, extractVideoUrl } from "../../scraper/extractor.js";
import { buildCourseStructure } from "../../scraper/navigator.js";
import {
  createCourseDirectory,
  createLessonDirectory,
  createModuleDirectory,
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
    const resetCount = db.resetErrorLessons();
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
    console.log(chalk.gray(`   Status: ${summary.downloaded} downloaded, ${summary.validated} ready, ${summary.error} errors, ${summary.pending} pending`));
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

    // Phase 1: Scan course structure and update database
    await scanCourseStructure(session.page, url, db, options);

    if (options.dryRun) {
      printStatusSummary(db);
      await browser.close();
      db.close();
      return;
    }

    // Create output directory
    const meta = db.getCourseMetadata();
    const courseDir = createCourseDirectory(config.outputDir, meta.name);
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
  const structureSpinner = ora("Scanning course structure...").start();

  try {
    const courseStructure = await buildCourseStructure(page, url);

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
        db.upsertLesson(moduleRecord.id, lesson.slug, lesson.name, lesson.url, lessonIndex);

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
    structureSpinner.succeed(
      `Found ${meta.totalModules} modules, ${meta.totalLessons} lessons` +
      (newLessons > 0 ? chalk.green(` (+${newLessons} new)`) : "")
    );
  } catch (error) {
    structureSpinner.fail("Failed to scan course structure");
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

  let validated = 0;
  let errors = 0;
  let skipped = 0;
  let currentModule = "";

  for (const lesson of lessonsToScan) {
    // Check for graceful shutdown
    if (!shouldContinue()) {
      console.log(chalk.yellow("\n   Stopping validation (shutdown requested)"));
      break;
    }

    // Print module header when it changes
    if (lesson.moduleName !== currentModule) {
      currentModule = lesson.moduleName;
      console.log(chalk.blue(`\n📖 ${currentModule}`));
    }

    const lessonSpinner = ora(`   ${lesson.name}`).start();

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
        lessonSpinner.succeed(chalk.gray(`   ${lesson.name} (no video)`));
        skipped++;
        continue;
      }

      // Handle unsupported video types early
      if (videoType === "youtube" || videoType === "wistia") {
        db.updateLessonScan(
          lesson.id,
          videoType,
          videoUrl,
          null,
          LessonStatus.ERROR,
          `${videoType.charAt(0).toUpperCase() + videoType.slice(1)} videos are not yet supported`,
          "UNSUPPORTED_PROVIDER"
        );
        lessonSpinner.warn(chalk.yellow(`   ${lesson.name}`));
        console.log(chalk.yellow(`      ⚠ ${videoType.toUpperCase()} not supported (requires yt-dlp)`));
        console.log(chalk.gray(`        URL: ${videoUrl}`));
        errors++;
        continue;
      }

      // Validate HLS for video types that support it
      if (videoType === "loom" || videoType === "vimeo") {
        // Pass page for Vimeo domain-restricted videos
        const validation = await validateVideoHls(
          videoUrl, 
          videoType,
          videoType === "vimeo" ? page : undefined,
          videoType === "vimeo" ? lesson.url : undefined
        );

        if (validation.isValid) {
          db.updateLessonScan(
            lesson.id,
            videoType,
            videoUrl,
            validation.hlsUrl,
            LessonStatus.VALIDATED
          );
          lessonSpinner.succeed(`   ${lesson.name} ✓`);
          validated++;
        } else {
          db.updateLessonScan(
            lesson.id,
            videoType,
            videoUrl,
            null,
            LessonStatus.ERROR,
            validation.error,
            validation.errorCode
          );
          lessonSpinner.fail(chalk.red(`   ${lesson.name}`));
          console.log(chalk.red(`      ⚠ ${validation.error}`));
          if (validation.details) {
            console.log(chalk.gray(`        ${validation.details}`));
          }
          errors++;
        }
      } else {
        // For native/unknown video types, mark as validated (will attempt direct download)
        db.updateLessonScan(lesson.id, videoType, videoUrl, null, LessonStatus.VALIDATED);
        lessonSpinner.succeed(`   ${lesson.name} (${videoType})`);
        validated++;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      db.updateLessonScan(lesson.id, null, null, null, LessonStatus.ERROR, errorMessage, "SCAN_ERROR");
      lessonSpinner.fail(chalk.red(`   ${lesson.name}`));
      console.log(chalk.red(`      Error: ${errorMessage}`));
      errors++;
    }
  }

  console.log(
    chalk.gray(`\n   Validation: ${validated} ready, ${skipped} no video, ${errors} errors`)
  );
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

  const videoTasks: VideoDownloadTask[] = [];
  let contentExtracted = 0;
  let contentSkipped = 0;
  let currentModule = "";

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
      console.log(chalk.yellow("\n   Stopping content extraction (shutdown requested)"));
      break;
    }

    const firstLesson = lessons[0]!;
    const moduleDir = createModuleDirectory(courseDir, firstLesson.modulePosition, firstLesson.moduleName);

    // Print module header
    if (firstLesson.moduleName !== currentModule) {
      currentModule = firstLesson.moduleName;
      console.log(chalk.blue(`\n📖 ${currentModule}`));
    }

    for (const lesson of lessons) {
      // Check for graceful shutdown
      if (!shouldContinue()) {
        break;
      }

      const lessonDir = createLessonDirectory(moduleDir, lesson.position, lesson.name);
      const syncStatus = isLessonSynced(lessonDir);

      // Check if content already exists
      if (!options.skipContent && !syncStatus.content) {
        const lessonSpinner = ora(`   ${lesson.name}`).start();

        try {
          const content = await extractLessonContent(page, lesson.url);
          const markdown = formatMarkdown(
            content.title,
            content.markdownContent,
            lesson.videoUrl,
            lesson.videoType
          );
          saveMarkdown(lessonDir, "content.md", markdown);
          lessonSpinner.succeed(`   ${lesson.name}`);
          contentExtracted++;
        } catch (error) {
          lessonSpinner.fail(`   ${lesson.name}`);
          console.log(chalk.red(`      Error: ${error}`));
        }
      } else {
        contentSkipped++;
      }

      // Queue video for download if not already downloaded
      if (!options.skipVideos && !syncStatus.video && lesson.videoUrl && lesson.videoType) {
        videoTasks.push({
          lessonName: lesson.name,
          videoUrl: lesson.hlsUrl ?? lesson.videoUrl,
          videoType: lesson.videoType as VideoDownloadTask["videoType"],
          outputPath: getVideoPath(lessonDir),
        });
      }
    }
  }

  console.log(chalk.gray(`\n   Content: ${contentExtracted} extracted, ${contentSkipped} cached`));

  return videoTasks;
}

/**
 * Phase 4: Download videos.
 */
async function downloadVideos(
  db: CourseDatabase,
  videoTasks: VideoDownloadTask[],
  courseDir: string,
  config: { concurrency: number; retryAttempts: number },
  _options?: SyncOptions
): Promise<void> {
  console.log(chalk.blue(`\n🎬 Phase 4: Downloading ${videoTasks.length} videos...\n`));

  const queue = new AsyncQueue<VideoDownloadTask>({
    concurrency: config.concurrency,
    maxRetries: config.retryAttempts,
  });

  queue.addAll(videoTasks.map((task) => ({ id: task.lessonName, data: task })));

  const videoSpinner = ora("Starting downloads...").start();

  // Track all download attempts for diagnostic log
  const downloadAttempts: DownloadAttempt[] = [];

  const result = await queue.process(async (task, id) => {
    videoSpinner.text = `   Downloading: ${id}`;

    const downloadResult = await downloadVideo(task, (progress) => {
      videoSpinner.text = `   ${id} (${Math.round(progress.percent)}%)`;
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

      // Update database with error
      const lesson = db.getLessonByUrl(task.videoUrl);
      if (lesson) {
        db.markLessonError(lesson.id, downloadResult.error ?? "Download failed", downloadResult.errorCode);
      }

      // Build detailed error message
      let errorMsg = downloadResult.error ?? "Download failed";
      if (downloadResult.details) {
        errorMsg += ` [${downloadResult.details}]`;
      }
      downloadAttempts.push(attempt);
      throw new Error(errorMsg);
    }

    // Update database with success
    const lesson = db.getLessonByUrl(task.videoUrl);
    if (lesson) {
      try {
        const stats = statSync(task.outputPath);
        db.markLessonDownloaded(lesson.id, stats.size);
      } catch {
        db.markLessonDownloaded(lesson.id);
      }
    }

    downloadAttempts.push(attempt);
  });

  videoSpinner.succeed(`   Videos: ${result.completed} downloaded, ${result.failed} failed`);

  if (result.errors.length > 0) {
    console.log(chalk.yellow("\n   Failed downloads:"));
    for (const error of result.errors) {
      console.log(chalk.red(`   - ${error.id}: ${error.error}`));
    }

    // Save diagnostic log
    const failedAttempts = downloadAttempts.filter((a) => !a.success);
    if (failedAttempts.length > 0) {
      const logPath = join(courseDir, `download-errors-${Date.now()}.json`);
      const logData = {
        timestamp: new Date().toISOString(),
        totalAttempts: videoTasks.length,
        successful: result.completed,
        failed: result.failed,
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
  console.log(chalk.green(`   ✓ Downloaded: ${summary.downloaded}`));
  console.log(chalk.blue(`   ◆ Validated:  ${summary.validated}`));
  console.log(chalk.gray(`   ○ Pending:    ${summary.pending}`));
  console.log(chalk.gray(`   - Skipped:    ${summary.skipped}`));

  if (summary.error > 0) {
    console.log(chalk.red(`   ✗ Errors:     ${summary.error}`));

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
