import chalk from "chalk";
import ora from "ora";
import { loadConfig } from "../../config/configManager.js";
import type { VideoDownloadTask } from "../../downloader/index.js";
import { getAuthenticatedSession } from "../../shared/auth.js";
import { createShutdownManager } from "../../shared/shutdown.js";
import {
  buildLearningSuiteCourseStructure,
  createLearningSuiteSessionVerifier,
  createFolderName,
  extractLearningSuitePostContent,
  getLearningSuiteDomain,
  getAuthToken,
  getLearningSuiteLessonUrl,
  isLearningSuiteLoginPage,
  isLearningSuitePortal,
  slugify,
  type LearningSuiteCourseStructure,
  type LearningSuiteScanProgress,
} from "../../scraper/learningsuite/index.js";
import {
  createCourseDirectory,
  createModuleDirectory,
  getDownloadFilePath,
  getVideoPath,
  saveMarkdown,
  isLessonSynced,
  downloadFile,
} from "../../storage/fileSystem.js";
import {
  createSyncProgressBar,
  downloadVideoTasks,
  formatHtmlLessonMarkdown,
  runParallelSyncStage,
} from "../syncPipeline.js";
import {
  initializeCourseState,
  LessonStatus,
  markLessonFailure,
  markLessonScanReady,
  recordVideoDownloadResult,
  type CourseDatabase,
} from "../../state/index.js";

/** Shutdown manager instance for this command. */
const shutdown = createShutdownManager();

export interface SyncLearningSuiteOptions {
  skipVideos?: boolean;
  skipContent?: boolean;
  dryRun?: boolean;
  limit?: number;
  visible?: boolean;
  quality?: string;
  courseName?: string;
  force?: boolean;
  retryFailed?: boolean;
}

export interface CompleteLearningSuiteOptions {
  visible?: boolean;
}

/**
 * Handles the sync-learningsuite command.
 * Downloads all content from a LearningSuite portal.
 */
export async function syncLearningSuiteCommand(
  url: string,
  options: SyncLearningSuiteOptions
): Promise<void> {
  shutdown.setup();

  console.log(chalk.blue("\n📚 LearningSuite Course Sync\n"));

  const config = loadConfig();
  const domain = getLearningSuiteDomain(url);
  if (!domain) {
    throw new Error("URL does not point to a LearningSuite tenant");
  }

  console.log(chalk.gray(`   Portal: ${domain}`));

  // Get authenticated session
  const useHeadless = options.visible ? false : config.headless;
  const spinner = ora("Connecting to LearningSuite...").start();

  let browser: Awaited<ReturnType<typeof getAuthenticatedSession>>["browser"] | undefined;
  let session: Awaited<ReturnType<typeof getAuthenticatedSession>>["session"] | undefined;
  let database: CourseDatabase | undefined;
  const closeDatabase = () => {
    if (database) {
      database.close();
      database = undefined;
    }
  };

  try {
    const result = await getAuthenticatedSession(
      {
        domain,
        loginUrl: url,
        isLoginPage: isLearningSuiteLoginPage,
        verifySession: createLearningSuiteSessionVerifier(url),
      },
      { headless: useHeadless }
    );
    browser = result.browser;
    session = result.session;
    shutdown.registerBrowser(browser);
    const sessionInfo = result.usedCachedSession ? " (cached session)" : "";
    spinner.succeed(`Connected to LearningSuite${sessionInfo}`);
  } catch (error) {
    if (shutdown.isShuttingDown()) return;

    spinner.fail("Failed to connect");
    console.log(chalk.red("\n❌ Authentication failed.\n"));
    console.log(chalk.gray(`   Tried to authenticate with: ${url}`));
    if (error instanceof Error) {
      console.log(chalk.gray(`   Error: ${error.message}`));
    }
    process.exit(1);
  }

  try {
    // Check if shutdown was requested
    if (!shutdown.shouldContinue()) {
      return;
    }

    const scanConcurrency = config.extractionConcurrency;
    const parallelLabel = scanConcurrency > 1 ? ` (${scanConcurrency}x parallel)` : "";
    console.log(chalk.blue(`\n📖 Scanning course structure...${parallelLabel}\n`));

    // Build course structure
    let courseStructure: LearningSuiteCourseStructure | null = null;
    let progressBar: ReturnType<typeof createSyncProgressBar> | undefined;
    let scanSpinner: ReturnType<typeof ora> | undefined;

    try {
      courseStructure = await buildLearningSuiteCourseStructure(
        session.page,
        url,
        (progress: LearningSuiteScanProgress) => {
          // Handle pre-progress phases with spinner
          if (progress.phase === "navigating" || progress.phase === "extracting") {
            if (!scanSpinner) {
              scanSpinner = ora({ text: progress.status ?? "Loading...", indent: 3 }).start();
            } else {
              scanSpinner.text = progress.status ?? "Loading...";
            }
          } else if (progress.phase === "course" && progress.courseName) {
            scanSpinner?.succeed(progress.courseName);
            scanSpinner = undefined;
          } else if (progress.phase === "modules" && progress.totalModules) {
            scanSpinner?.stop();
            scanSpinner = undefined;
            progressBar = createSyncProgressBar();
            progressBar.start(progress.totalModules, 0, { status: "Scanning modules..." });
          } else if (progress.phase === "lessons") {
            if (progress.skippedLocked) {
              // Locked modules are not counted in progress
            } else if (progress.lessonsFound !== undefined) {
              const current = progress.modulesProcessed ?? 1;
              const shortName =
                (progress.currentModule ?? "Module").length > 30
                  ? (progress.currentModule ?? "Module").substring(0, 27) + "..."
                  : (progress.currentModule ?? "Module");
              progressBar?.update(current, {
                status: `${shortName} (${progress.lessonsFound} lessons)`,
              });
            }
          } else if (progress.phase === "done") {
            scanSpinner?.stop();
            progressBar?.stop();
          }
        },
        {
          context: session.context,
          concurrency: scanConcurrency,
          shouldContinue: shutdown.shouldContinue,
        }
      );
    } catch (error) {
      if (shutdown.isShuttingDown()) {
        scanSpinner?.stop();
        progressBar?.stop();
        return;
      }

      scanSpinner?.fail("Failed");
      progressBar?.stop();
      console.log(chalk.red("   Failed to scan course structure"));
      if (error instanceof Error) {
        console.log(chalk.gray(`   Error: ${error.message}`));
      }
      throw error;
    }

    if (!courseStructure) {
      console.log(chalk.red("\n❌ Could not extract course structure"));
      console.log(chalk.gray("   This might mean:"));
      console.log(chalk.gray("   - The portal is not a supported LearningSuite portal"));
      console.log(chalk.gray("   - You don't have access to this course"));
      console.log(chalk.gray("   - The portal structure has changed"));
      await browser.close();
      process.exit(1);
    }

    // Override course name if provided
    if (options.courseName) {
      courseStructure.course.title = options.courseName;
    }

    // Print summary
    const totalLessons = courseStructure.modules.reduce((sum, mod) => sum + mod.lessons.length, 0);
    const lockedModules = courseStructure.modules.filter((m) => m.isLocked).length;
    const lockedLessons = courseStructure.modules.reduce(
      (sum, mod) => sum + mod.lessons.filter((l) => l.isLocked).length,
      0
    );

    console.log();
    const parts: string[] = [];
    parts.push(`${courseStructure.modules.length} modules`);
    parts.push(`${totalLessons} lessons`);
    if (lockedModules > 0) parts.push(chalk.yellow(`${lockedModules} modules locked`));
    if (lockedLessons > 0) parts.push(chalk.yellow(`${lockedLessons} lessons locked`));
    console.log(`   Found: ${parts.join(", ")}`);

    if (lockedLessons > 0) {
      console.log(chalk.gray(`   💡 Tip: Use 'offcourse complete <url>' to unlock lessons first`));
    }

    if (courseStructure.emptyModuleTitles?.length) {
      console.log(
        chalk.yellow(
          `   ⚠️  No lessons found in ${courseStructure.emptyModuleTitles.length} scanned module${courseStructure.emptyModuleTitles.length === 1 ? "" : "s"}: ${courseStructure.emptyModuleTitles.join(", ")}`
        )
      );
    }

    if (options.dryRun) {
      printCourseStructure(courseStructure);
      await browser.close();
      return;
    }

    const canonicalCourseUrl = `https://${courseStructure.domain}/student/course/${courseStructure.courseSlug ?? courseStructure.course.id}/${courseStructure.course.id}`;
    const state = initializeCourseState(
      "learningsuite",
      canonicalCourseUrl,
      {
        name: courseStructure.course.title,
        url: canonicalCourseUrl,
        modules: courseStructure.modules.map((module, moduleIndex) => ({
          slug: module.id,
          name: module.title,
          position: moduleIndex,
          isLocked: module.isLocked,
          lessons: module.lessons.map((lesson, lessonIndex) => ({
            slug: lesson.id,
            name: lesson.title,
            url: getLearningSuiteLessonUrl(
              courseStructure.domain,
              courseStructure.courseSlug ?? courseStructure.course.id,
              courseStructure.course.id,
              lesson.moduleId,
              lesson.id
            ),
            position: lessonIndex,
            isLocked: lesson.isLocked,
          })),
        })),
      },
      options
    );
    database = state.database;
    shutdown.registerCleanup(closeDatabase);
    console.log(chalk.gray(`   State: ~/.offcourse/cache/${state.key}.db`));

    // Create course directory
    const courseSlug = slugify(courseStructure.course.title);
    const courseDir = await createCourseDirectory(config.outputDir, courseSlug);
    console.log(chalk.gray(`\n📁 Output: ${courseDir}\n`));

    // Process lessons - build task list first, then process in parallel
    const videoTasks: VideoDownloadTask[] = [];
    let contentExtracted = 0;
    let skipped = 0;
    let skippedLocked = 0;

    // Build list of lessons to process with their metadata
    interface LessonTask {
      lesson: (typeof courseStructure.modules)[0]["lessons"][0];
      lessonIndex: number;
      moduleDir: string;
      moduleIndex: number;
      lessonUrl: string;
      stateId: number;
    }
    const lessonTasks: LessonTask[] = [];

    // Calculate accessible lessons and build task list
    for (const [modIndex, module] of courseStructure.modules.entries()) {
      if (module.isLocked) continue;

      const moduleDir = await createModuleDirectory(courseDir, modIndex, module.title);

      for (const [lessonIndex, lesson] of module.lessons.entries()) {
        if (lesson.isLocked) {
          skippedLocked++;
          continue;
        }
        const lessonUrl = getLearningSuiteLessonUrl(
          courseStructure.domain,
          courseStructure.courseSlug ?? courseStructure.course.id,
          courseStructure.course.id,
          lesson.moduleId,
          lesson.id
        );
        const stateLesson = state.lessonsByUrl.get(lessonUrl);
        if (!stateLesson) throw new Error(`Missing state record for ${lesson.title}`);
        lessonTasks.push({
          lesson,
          lessonIndex,
          moduleDir,
          moduleIndex: modIndex,
          lessonUrl,
          stateId: stateLesson.id,
        });
      }
    }

    // Apply limit
    const lessonLimit = options.limit;
    let totalToProcess = lessonTasks.length;
    if (lessonLimit) {
      totalToProcess = Math.min(lessonTasks.length, lessonLimit);
      lessonTasks.splice(lessonLimit); // Trim to limit
      console.log(chalk.yellow(`   Limiting to ${totalToProcess} lessons\n`));
    }

    // Phase 2: Extract content and queue downloads (parallel)
    const extractionConcurrency = config.extractionConcurrency;
    const phase2Label = options.skipContent
      ? `🎬 Scanning ${totalToProcess} lessons for videos (${extractionConcurrency}x parallel)...`
      : `📝 Extracting content for ${totalToProcess} lessons (${extractionConcurrency}x parallel)...`;
    console.log(chalk.blue(`\n${phase2Label}\n`));

    const resultsLock = { videoTasks, contentExtracted: 0, skipped: 0 };

    // Worker function to process a single lesson
    const processLesson = async (
      page: import("playwright").Page,
      task: LessonTask
    ): Promise<void> => {
      const { lesson, lessonIndex, moduleDir, lessonUrl, stateId } = task;

      try {
        const syncStatus = await isLessonSynced(moduleDir, lessonIndex, lesson.title);
        const stateLesson = database?.getLessonByUrl(lessonUrl);
        const retryFailed = state.retryLessonIds.has(stateId);
        if (syncStatus.video && stateLesson?.status !== LessonStatus.DOWNLOADED) {
          database?.markLessonDownloaded(stateId);
        }
        const needsContent =
          !options.skipContent && (options.force === true || retryFailed || !syncStatus.content);
        const needsVideo =
          !options.skipVideos &&
          (options.force === true ||
            retryFailed ||
            (stateLesson?.status !== LessonStatus.DOWNLOADED && !syncStatus.video));

        if (!needsContent && !needsVideo) {
          resultsLock.skipped++;
          return;
        }

        // Extract content
        const content = await extractLearningSuitePostContent(
          page,
          lessonUrl,
          courseStructure.tenantId,
          courseStructure.course.id,
          lesson.id
        );

        if (!content) throw new Error(`Could not extract ${lesson.title}`);

        // Save markdown if needed
        if (needsContent) {
          const markdown = formatLearningSuiteMarkdown(
            content.title,
            content.description,
            content.htmlContent
          );

          await saveMarkdown(
            moduleDir,
            createFolderName(lessonIndex, lesson.title) + ".md",
            markdown
          );

          // Download attachments
          for (const attachment of content.attachments) {
            if (attachment.url) {
              const attachmentPath = getDownloadFilePath(
                moduleDir,
                lessonIndex,
                lesson.title,
                attachment.name
              );
              await downloadFile(attachment.url, attachmentPath);
            }
          }

          resultsLock.contentExtracted++;
        } else {
          resultsLock.skipped++;
        }

        // Queue video download
        if (needsVideo && content.video?.url) {
          const videoUrl = content.video.hlsUrl ?? content.video.url;
          const videoTask: VideoDownloadTask = {
            lessonId: stateId,
            lessonName: lesson.title,
            videoUrl,
            videoType: mapVideoType(content.video.type, videoUrl),
            outputPath: getVideoPath(moduleDir, lessonIndex, lesson.title),
            preferredQuality: options.quality,
          };
          resultsLock.videoTasks.push(videoTask);
          if (database) markLessonScanReady(database, stateId, videoTask);
        } else if (needsVideo) {
          database?.markLessonSkipped(stateId, "No video found");
        }
      } catch (error) {
        if (database) markLessonFailure(database, stateId, error, "EXTRACTION_ERROR");
        // Log error but continue processing
        const shortName =
          lesson.title.length > 30 ? lesson.title.substring(0, 27) + "..." : lesson.title;
        console.error(`\n   ⚠️ Error: ${shortName}`);
      }
    };

    await runParallelSyncStage({
      context: session.context,
      mainPage: session.page,
      tasks: lessonTasks,
      concurrency: extractionConcurrency,
      shouldContinue: shutdown.shouldContinue,
      processTask: processLesson,
      getTaskLabel: (task) => task.lesson.title,
    });

    // Update counters from results lock
    contentExtracted = resultsLock.contentExtracted;
    skipped = resultsLock.skipped;

    // Print content summary
    console.log();
    const contentParts: string[] = [];
    if (contentExtracted > 0) contentParts.push(chalk.green(`${contentExtracted} extracted`));
    if (skipped > 0) contentParts.push(chalk.gray(`${skipped} cached`));
    if (skippedLocked > 0) contentParts.push(chalk.yellow(`${skippedLocked} locked`));
    console.log(`   Content: ${contentParts.join(", ")}`);

    // Phase 3: Download videos
    if (!options.skipVideos && videoTasks.length > 0) {
      // Extract cookies and auth token from session for authenticated video downloads
      const browserCookies = await session.page.context().cookies();
      const cookieString = browserCookies.map((c) => `${c.name}=${c.value}`).join("; ");
      const refererUrl = `https://${courseStructure.domain}/`;
      const authToken = await getAuthToken(session.page);

      // Add cookies, referer, and auth token to all video tasks
      for (const task of videoTasks) {
        task.cookies = cookieString;
        task.referer = refererUrl;
        if (authToken) {
          task.authToken = authToken;
        }
      }

      const downloads = await downloadVideoTasks(videoTasks, {
        concurrency: config.concurrency,
        shouldContinue: shutdown.shouldContinue,
      });
      if (database) {
        for (const outcome of downloads.outcomes) {
          recordVideoDownloadResult(database, outcome.task, outcome.result, outcome.error);
        }
      }
    }

    console.log(chalk.green("\n✅ Sync complete!\n"));
  } catch (error) {
    if (shutdown.isShuttingDown()) return;

    console.error(chalk.red("\n❌ Sync failed"));
    if (error instanceof Error) {
      console.error(chalk.gray(`   Error: ${error.message}`));
    }
    throw error;
  } finally {
    closeDatabase();
    // Always close the browser to prevent hanging
    if (browser) {
      try {
        await browser.close();
      } catch {
        // Ignore errors during browser close
      }
    }
  }
}

/**
 * Maps LearningSuite video type to downloader video type.
 */
function mapVideoType(type: string, url?: string): VideoDownloadTask["videoType"] {
  // Special case: segments:... URLs use direct HLS segment download
  if (url?.startsWith("segments:")) {
    return "hls";
  }

  switch (type) {
    case "hls":
      return "highlevel"; // Use HLS downloader for standard HLS
    case "vimeo":
      return "vimeo";
    case "loom":
      return "loom";
    case "native":
      return "native";
    default:
      return "native";
  }
}

/**
 * Format markdown content for LearningSuite lessons.
 */
export function formatLearningSuiteMarkdown(
  title: string,
  description: string | null,
  htmlContent: string | null
): string {
  return formatHtmlLessonMarkdown({ title, description, htmlContent });
}

/**
 * Print course structure (for dry-run mode).
 */
function printCourseStructure(structure: LearningSuiteCourseStructure): void {
  console.log(chalk.cyan("\n📋 Course Structure\n"));
  console.log(chalk.white(`   ${structure.course.title}`));
  console.log(chalk.gray(`   Tenant: ${structure.tenantId}`));
  console.log(chalk.gray(`   Domain: ${structure.domain}`));
  console.log();

  for (const [i, module] of structure.modules.entries()) {
    const lockedTag = module.isLocked ? chalk.yellow(" [LOCKED]") : "";
    console.log(chalk.white(`   ${String(i + 1).padStart(2)}. ${module.title}${lockedTag}`));

    for (const [j, lesson] of module.lessons.slice(0, 5).entries()) {
      const lessonLocked = lesson.isLocked ? chalk.yellow(" 🔒") : "";
      console.log(
        chalk.gray(`       ${String(j + 1).padStart(2)}. ${lesson.title}${lessonLocked}`)
      );
    }

    if (module.lessons.length > 5) {
      console.log(chalk.gray(`       ... and ${module.lessons.length - 5} more`));
    }
    console.log();
  }
}

/**
 * Complete command - mark lessons as complete to unlock sequential content.
 */
export async function completeLearningSuiteCommand(
  url: string,
  options: CompleteLearningSuiteOptions
): Promise<void> {
  shutdown.setup();
  console.log(chalk.cyan("\n🔓 LearningSuite Complete\n"));

  if (!isLearningSuitePortal(url)) {
    console.error(chalk.red("Error: URL does not appear to be a LearningSuite portal"));
    process.exit(1);
  }

  const domain = getLearningSuiteDomain(url);
  if (!domain) {
    throw new Error("URL does not point to a LearningSuite tenant");
  }
  console.log(chalk.gray(`   Domain: ${domain}`));

  // Get authenticated session
  const useHeadless = !options.visible;
  const spinner = ora("Connecting to LearningSuite...").start();

  let browser: import("playwright").Browser;
  let session: { page: import("playwright").Page; context: import("playwright").BrowserContext };

  try {
    const result = await getAuthenticatedSession(
      {
        domain,
        loginUrl: url,
        isLoginPage: isLearningSuiteLoginPage,
        verifySession: createLearningSuiteSessionVerifier(url),
      },
      { headless: useHeadless }
    );
    browser = result.browser;
    session = result.session;
    shutdown.registerBrowser(browser);
    const sessionInfo = result.usedCachedSession ? " (cached session)" : "";
    spinner.succeed(`Connected to LearningSuite${sessionInfo}`);
  } catch (error) {
    if (shutdown.isShuttingDown()) return;

    spinner.fail("Failed to connect");
    console.log(chalk.red("\n❌ Authentication failed.\n"));
    if (error instanceof Error) {
      console.log(chalk.gray(`   Error: ${error.message}`));
    }
    process.exit(1);
  }

  try {
    let iteration = 0;
    let lastTotalLessons = 0;
    let lastCompletedLessons = 0;
    let grandTotalCompleted = 0;
    const maxIterations = 10; // Safety limit

    // Iterative loop: keep going until no new content is unlocked
    while (shutdown.shouldContinue() && iteration < maxIterations) {
      iteration++;
      console.log(
        chalk.blue(`\n📊 ${iteration === 1 ? "Scanning" : "Re-scanning"} course structure...\n`)
      );

      const courseStructure = await buildLearningSuiteCourseStructure(session.page, url);

      if (!courseStructure) {
        console.error(chalk.red("Failed to build course structure"));
        await browser.close();
        process.exit(1);
      }

      const totalLessons = courseStructure.modules.reduce(
        (sum, mod) => sum + mod.lessons.length,
        0
      );
      const completedLessons = courseStructure.modules.reduce(
        (sum, mod) => sum + mod.lessons.filter((l) => l.isCompleted).length,
        0
      );
      const lockedLessons = courseStructure.modules.reduce(
        (sum, mod) => sum + mod.lessons.filter((l) => l.isLocked).length,
        0
      );
      const incompleteLessons = totalLessons - completedLessons;
      const percentage = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;

      console.log(
        chalk.gray(
          `   Found: ${totalLessons} lessons, ${completedLessons} completed (${percentage}%)`
        )
      );
      if (incompleteLessons > 0) {
        console.log(chalk.gray(`   Remaining: ${incompleteLessons} incomplete`));
      }
      if (lockedLessons > 0) {
        console.log(chalk.yellow(`   Note: ${lockedLessons} lessons still locked`));
      }

      // Check if anything changed since last iteration
      if (iteration > 1) {
        const newLessons = totalLessons - lastTotalLessons;
        if (newLessons > 0) {
          console.log(chalk.green(`   🆕 ${newLessons} new lessons unlocked!`));
        } else if (totalLessons === lastTotalLessons && completedLessons === lastCompletedLessons) {
          console.log(chalk.gray(`   No new content unlocked.`));
          break;
        }
      }

      // All done?
      if (incompleteLessons === 0) {
        console.log(chalk.green("\n✅ All lessons are completed!\n"));
        break;
      }

      lastTotalLessons = totalLessons;
      lastCompletedLessons = completedLessons;

      console.log(chalk.blue(`\n🔓 Round ${iteration}: Completing lessons...\n`));

      let roundCompleted = 0;

      // Navigate to course page to find modules
      const courseUrl = `https://${courseStructure.domain}/student/course/${courseStructure.courseSlug ?? courseStructure.course.id}/${courseStructure.course.id}`;
      await session.page.goto(courseUrl, { waitUntil: "load" });
      await session.page.waitForTimeout(2000);

      // Start ALL unstarted modules in a loop using Playwright locator
      let modulesStarted = 0;
      const maxModuleStarts = 20; // Safety limit

      while (shutdown.shouldContinue() && modulesStarted < maxModuleStarts) {
        // Find all elements containing "START" text (case-sensitive, exact match)
        const startButtons = session.page.locator("text=START");
        const startCount = await startButtons.count();

        if (startCount === 0) {
          break; // No more modules to start
        }

        console.log(chalk.gray(`   Found ${startCount} unstarted module(s)...`));

        try {
          // Click the first START button
          await startButtons.first().click({ timeout: 5000 });
          modulesStarted++;
          console.log(chalk.green(`   ▶️ Started module ${modulesStarted}`));

          // Wait for navigation
          await session.page.waitForTimeout(3000);

          // Go back to course page
          await session.page.goto(courseUrl, { waitUntil: "load" });
          await session.page.waitForTimeout(2000);
        } catch {
          console.log(chalk.gray(`   Could not click START`));
          break;
        }
      }

      if (modulesStarted > 0) {
        console.log(chalk.green(`   ✓ Started ${modulesStarted} modules\n`));
      }

      // Go through each module and complete its lessons
      for (const mod of courseStructure.modules) {
        // Skip modules that are 100% complete or locked
        const moduleComplete = mod.lessons.every((l) => l.isCompleted);
        const moduleLocked = mod.isLocked;

        if (moduleComplete) {
          continue; // Skip completed modules
        }
        if (moduleLocked) {
          console.log(chalk.yellow(`   ⏭️ Skipping locked module: ${mod.title}`));
          continue;
        }

        console.log(chalk.cyan(`   📁 Processing: ${mod.title}`));

        // Navigate to each incomplete lesson in this module
        for (const lesson of mod.lessons) {
          if (lesson.isCompleted) {
            continue; // Skip completed lessons
          }
          if (lesson.isLocked) {
            continue; // Skip locked lessons
          }

          // Navigate to the lesson
          // URL format: /student/course/{slug}/{courseId}/{topicId}
          // The topicId is the lesson.id - server auto-expands to full URL
          const lessonUrl = `https://${courseStructure.domain}/student/course/${courseStructure.courseSlug ?? courseStructure.course.id}/${courseStructure.course.id}/${lesson.id}`;

          try {
            await session.page.goto(lessonUrl, { waitUntil: "load" });
            await session.page.waitForTimeout(2000);
          } catch {
            continue; // Skip if navigation fails
          }

          const shortName =
            lesson.title.length > 40 ? lesson.title.substring(0, 37) + "..." : lesson.title;
          process.stdout.write(chalk.gray(`      ⏳ ${shortName}...`));

          // Check any unchecked checkboxes (for AGB etc.)
          await session.page.evaluate(() => {
            document.querySelectorAll('input[type="checkbox"]:not(:checked)').forEach((cb) => {
              (cb as HTMLInputElement).click();
            });
          });

          // Find and click the complete button
          let completeButton = session.page.locator('button:has-text("Abschließen")');
          let buttonCount = await completeButton.count();

          if (buttonCount === 0) {
            completeButton = session.page.locator('button:has-text("schlie")');
            buttonCount = await completeButton.count();
          }
          if (buttonCount === 0) {
            completeButton = session.page.locator("button.MuiButton-colorSuccess");
            buttonCount = await completeButton.count();
          }

          if (buttonCount === 0) {
            process.stdout.write(chalk.yellow(` no button\n`));
            continue;
          }

          try {
            await completeButton.first().click({ timeout: 5000 });
            await session.page.waitForTimeout(1000);
            roundCompleted++;
            grandTotalCompleted++;
            process.stdout.write(chalk.green(` ✓\n`));
          } catch {
            process.stdout.write(chalk.yellow(` click failed\n`));
          }
        }
      }

      if (roundCompleted > 0) {
        console.log(chalk.green(`\n   ✓ Round ${iteration}: ${roundCompleted} lessons completed`));
      } else {
        console.log(chalk.gray(`\n   Round ${iteration}: No lessons completed in this round`));
      }
    }

    // Final summary
    if (grandTotalCompleted > 0) {
      console.log(chalk.green(`\n🎉 Total: ${grandTotalCompleted} lessons marked as complete!\n`));
    }
    console.log(chalk.green("✅ Complete finished!\n"));
  } catch (error) {
    if (shutdown.isShuttingDown()) return;

    console.error(chalk.red("\n❌ Complete failed"));
    if (error instanceof Error) {
      console.error(chalk.gray(`   Error: ${error.message}`));
    }
    throw error;
  } finally {
    // Always close the browser to prevent hanging
    if (browser) {
      try {
        await browser.close();
      } catch {
        // Ignore errors during browser close
      }
    }
  }
}
