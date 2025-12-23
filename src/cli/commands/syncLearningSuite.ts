import chalk from "chalk";
import cliProgress from "cli-progress";
import ora from "ora";
import { join } from "node:path";
import { loadConfig } from "../../config/configManager.js";
import { downloadVideo, type VideoDownloadTask } from "../../downloader/index.js";
import { getAuthenticatedSession, createLoginChecker } from "../../shared/auth.js";
import {
  buildLearningSuiteCourseStructure,
  createFolderName,
  extractLearningSuitePostContent,
  getLearningSuiteLessonUrl,
  slugify,
  type LearningSuiteCourseStructure,
  type LearningSuiteScanProgress,
} from "../../scraper/learningsuite/index.js";
import {
  createCourseDirectory,
  createModuleDirectory,
  getVideoPath,
  saveMarkdown,
  isLessonSynced,
  downloadFile,
} from "../../storage/fileSystem.js";

/**
 * Tracks if shutdown has been requested (Ctrl+C).
 */
let isShuttingDown = false;

/**
 * Resources to clean up on shutdown.
 */
interface CleanupResources {
  browser?: import("playwright").Browser;
}

const cleanupResources: CleanupResources = {};

/**
 * Graceful shutdown handler.
 */
function setupShutdownHandlers(): void {
  const shutdown = async (signal: string) => {
    if (isShuttingDown) {
      console.log(chalk.red("\n\n⚠️  Force exit"));
      process.exit(1);
    }

    isShuttingDown = true;
    console.log(chalk.yellow(`\n\n⏹️  ${signal} received, shutting down gracefully...`));

    try {
      if (cleanupResources.browser) {
        await cleanupResources.browser.close();
      }
      console.log(chalk.gray("   Cleanup complete."));
    } catch {
      // Ignore cleanup errors
    }

    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

/**
 * Check if we should continue processing or stop due to shutdown.
 */
function shouldContinue(): boolean {
  return !isShuttingDown;
}

export interface SyncLearningSuiteOptions {
  skipVideos?: boolean;
  skipContent?: boolean;
  dryRun?: boolean;
  limit?: number;
  visible?: boolean;
  quality?: string;
  courseName?: string;
}

export interface CompleteLearningSuiteOptions {
  visible?: boolean;
}

/**
 * Extracts the domain from a LearningSuite URL.
 */
function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * LearningSuite-specific login page checker.
 * Note: We check for /auth at the end of path OR as a path segment to be safe.
 */
export const isLearningSuiteLoginPage = createLoginChecker([
  /\/auth(?:$|\/|\?)/, // /auth, /auth/, /auth?...
  /\/login/,
  /\/signin/,
  /accounts\.google\.com/,
]);

/**
 * Verifies if the user has a valid LearningSuite session.
 *
 * LearningSuite stores authentication in various ways:
 * 1. localStorage tokens (accessToken, jwt, etc.)
 * 2. Cookies (session cookies)
 * 3. URL-based redirect (if we're not on /auth, we're likely logged in)
 */
async function hasValidLearningSuiteSession(page: import("playwright").Page): Promise<boolean> {
  const currentUrl = page.url();

  // Primary check: If we're NOT on an auth page after navigation, we're logged in
  // This is the most reliable indicator for LearningSuite
  if (!isLearningSuiteLoginPage(currentUrl)) {
    // Double-check we're on a student/course page (not an error page)
    if (
      currentUrl.includes("/student") ||
      currentUrl.includes("/course") ||
      currentUrl.includes("/dashboard")
    ) {
      return true;
    }
  }

  // Secondary check: Look for auth tokens in storage
  const hasToken = await page.evaluate(() => {
    // Check localStorage for various token patterns
    const tokenKeys = ["accessToken", "token", "authToken", "jwt", "access_token", "id_token"];
    for (const key of tokenKeys) {
      if (localStorage.getItem(key)) return true;
    }

    // Check sessionStorage
    for (const key of tokenKeys) {
      if (sessionStorage.getItem(key)) return true;
    }

    // Check for any key containing 'auth' or 'token' or 'session'
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        const keyLower = key.toLowerCase();
        if (
          keyLower.includes("auth") ||
          keyLower.includes("token") ||
          keyLower.includes("session")
        ) {
          const value = localStorage.getItem(key);
          // Make sure it's not empty
          if (value && value.length > 10) return true;
        }
      }
    }

    // Check for user-related keys (often set after login)
    const userKeys = ["user", "currentUser", "userInfo", "profile"];
    for (const key of userKeys) {
      if (localStorage.getItem(key)) return true;
    }

    return false;
  });

  return hasToken;
}

/**
 * Detects if a URL is a LearningSuite portal.
 */
export function isLearningSuitePortal(url: string): boolean {
  return url.includes(".learningsuite.io");
}

/**
 * Handles the sync-learningsuite command.
 * Downloads all content from a LearningSuite portal.
 */
export async function syncLearningSuiteCommand(
  url: string,
  options: SyncLearningSuiteOptions
): Promise<void> {
  setupShutdownHandlers();

  console.log(chalk.blue("\n📚 LearningSuite Course Sync\n"));

  const config = loadConfig();
  const domain = extractDomain(url);

  console.log(chalk.gray(`   Portal: ${domain}`));

  // Get authenticated session
  const useHeadless = options.visible ? false : config.headless;
  const spinner = ora("Connecting to LearningSuite...").start();

  let browser;
  let session;

  try {
    const result = await getAuthenticatedSession(
      {
        domain,
        loginUrl: url,
        isLoginPage: isLearningSuiteLoginPage,
        verifySession: hasValidLearningSuiteSession,
      },
      { headless: useHeadless }
    );
    browser = result.browser;
    session = result.session;
    cleanupResources.browser = browser;
    spinner.succeed("Connected to LearningSuite");
  } catch (error) {
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
    if (!shouldContinue()) {
      return;
    }

    console.log(chalk.blue("\n📖 Scanning course structure...\n"));

    // Build course structure
    let courseStructure: LearningSuiteCourseStructure | null = null;
    let progressBar: cliProgress.SingleBar | undefined;

    try {
      courseStructure = await buildLearningSuiteCourseStructure(
        session.page,
        url,
        (progress: LearningSuiteScanProgress) => {
          if (progress.phase === "course" && progress.courseName) {
            console.log(chalk.white(`   Course: ${progress.courseName}`));
          } else if (progress.phase === "modules" && progress.totalModules) {
            progressBar = new cliProgress.SingleBar(
              {
                format: "   {bar} {percentage}% | {value}/{total} | {status}",
                barCompleteChar: "█",
                barIncompleteChar: "░",
                barsize: 30,
                hideCursor: true,
              },
              cliProgress.Presets.shades_grey
            );
            progressBar.start(progress.totalModules, 0, { status: "Scanning modules..." });
          } else if (progress.phase === "lessons") {
            if (progress.skippedLocked) {
              progressBar?.increment({ status: `🔒 ${progress.currentModule ?? "Locked"}` });
            } else if (progress.lessonsFound !== undefined) {
              progressBar?.increment({
                status: `${progress.currentModule ?? "Module"} (${progress.lessonsFound} lessons)`,
              });
            } else {
              const moduleName = progress.currentModule ?? "";
              const shortName =
                moduleName.length > 35 ? moduleName.substring(0, 32) + "..." : moduleName;
              progressBar?.update(progress.currentModuleIndex ?? 0, { status: shortName });
            }
          } else if (progress.phase === "done") {
            progressBar?.stop();
          }
        }
      );
    } catch (error) {
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

    if (options.dryRun) {
      printCourseStructure(courseStructure);
      await browser.close();
      return;
    }

    // Create course directory
    const courseSlug = slugify(courseStructure.course.title);
    const courseDir = await createCourseDirectory(config.outputDir, courseSlug);
    console.log(chalk.gray(`\n📁 Output: ${courseDir}\n`));

    // Process lessons
    const videoTasks: VideoDownloadTask[] = [];
    let contentExtracted = 0;
    let skipped = 0;
    let skippedLocked = 0;
    let processed = 0;

    // Calculate accessible lessons (excluding locked)
    const accessibleLessonsCount = courseStructure.modules.reduce(
      (sum, mod) => (mod.isLocked ? sum : sum + mod.lessons.filter((l) => !l.isLocked).length),
      0
    );

    // Apply limit
    const lessonLimit = options.limit;
    let totalToProcess = accessibleLessonsCount;
    if (lessonLimit) {
      totalToProcess = Math.min(accessibleLessonsCount, lessonLimit);
      console.log(chalk.yellow(`   Limiting to ${totalToProcess} lessons\n`));
    }

    // Phase 2: Extract content and queue downloads
    const phase2Label = options.skipContent
      ? `🎬 Scanning ${totalToProcess} lessons for videos...`
      : `📝 Extracting content for ${totalToProcess} lessons...`;
    console.log(chalk.blue(`\n${phase2Label}\n`));

    const contentProgressBar = new cliProgress.SingleBar(
      {
        format: "   {bar} {percentage}% | {value}/{total} | {status}",
        barCompleteChar: "█",
        barIncompleteChar: "░",
        barsize: 30,
        hideCursor: true,
      },
      cliProgress.Presets.shades_grey
    );

    contentProgressBar.start(totalToProcess, 0, { status: "Starting..." });

    for (const [modIndex, module] of courseStructure.modules.entries()) {
      if (!shouldContinue()) break;
      if (lessonLimit && processed >= lessonLimit) break;

      if (module.isLocked) {
        continue;
      }

      const moduleDir = await createModuleDirectory(courseDir, modIndex, module.title);

      for (const [lessonIndex, lesson] of module.lessons.entries()) {
        if (!shouldContinue()) break;
        if (lessonLimit && processed >= lessonLimit) break;

        // Skip locked lessons
        if (lesson.isLocked) {
          skippedLocked++;
          continue;
        }

        const shortName =
          lesson.title.length > 40 ? lesson.title.substring(0, 37) + "..." : lesson.title;
        contentProgressBar.update(processed, { status: shortName });

        // Check if already synced
        const syncStatus = await isLessonSynced(moduleDir, lessonIndex, lesson.title);

        if (!options.skipContent && !syncStatus.content) {
          try {
            // Get full lesson URL
            const lessonUrl = getLearningSuiteLessonUrl(
              courseStructure.domain,
              courseStructure.courseSlug ?? courseStructure.course.id,
              courseStructure.course.id,
              lesson.moduleId, // Use lesson's own moduleId (topicId) for correct URL
              lesson.id
            );

            // Extract content
            const content = await extractLearningSuitePostContent(
              session.page,
              lessonUrl,
              courseStructure.tenantId,
              courseStructure.course.id,
              lesson.id
            );

            if (content) {
              // Save markdown
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
                  const attachmentPath = join(
                    moduleDir,
                    `${createFolderName(lessonIndex, lesson.title)}-${attachment.name}`
                  );
                  await downloadFile(attachment.url, attachmentPath);
                }
              }

              // Queue video download
              if (!options.skipVideos && !syncStatus.video && content.video?.url) {
                videoTasks.push({
                  lessonId: lesson.id as unknown as number,
                  lessonName: lesson.title,
                  videoUrl: content.video.hlsUrl ?? content.video.url,
                  videoType: mapVideoType(content.video.type),
                  outputPath: getVideoPath(moduleDir, lessonIndex, lesson.title),
                  preferredQuality: options.quality,
                });
              }

              contentExtracted++;
            }
          } catch (error) {
            console.error(`\nError extracting ${lesson.title}:`, error);
          }
        } else {
          skipped++;

          // Still queue video if content was skipped but video not downloaded
          if (!options.skipVideos && !syncStatus.video) {
            try {
              const lessonUrl = getLearningSuiteLessonUrl(
                courseStructure.domain,
                courseStructure.courseSlug ?? courseStructure.course.id,
                courseStructure.course.id,
                lesson.moduleId, // Use lesson's own moduleId (topicId) for correct URL
                lesson.id
              );

              const content = await extractLearningSuitePostContent(
                session.page,
                lessonUrl,
                courseStructure.tenantId,
                courseStructure.course.id,
                lesson.id
              );

              if (content?.video?.url) {
                videoTasks.push({
                  lessonId: lesson.id as unknown as number,
                  lessonName: lesson.title,
                  videoUrl: content.video.hlsUrl ?? content.video.url,
                  videoType: mapVideoType(content.video.type),
                  outputPath: getVideoPath(moduleDir, lessonIndex, lesson.title),
                  preferredQuality: options.quality,
                });
              }
            } catch {
              // Skip if we can't get video URL
            }
          }
        }

        processed++;
        contentProgressBar.update(processed, { status: shortName });
      }
    }

    contentProgressBar.stop();

    // Print content summary
    console.log();
    const contentParts: string[] = [];
    if (contentExtracted > 0) contentParts.push(chalk.green(`${contentExtracted} extracted`));
    if (skipped > 0) contentParts.push(chalk.gray(`${skipped} cached`));
    if (skippedLocked > 0) contentParts.push(chalk.yellow(`${skippedLocked} locked`));
    console.log(`   Content: ${contentParts.join(", ")}`);

    // Phase 3: Download videos
    if (!options.skipVideos && videoTasks.length > 0) {
      // Extract cookies from session for authenticated video downloads
      const browserCookies = await session.page.context().cookies();
      const cookieString = browserCookies.map((c) => `${c.name}=${c.value}`).join("; ");
      const refererUrl = `https://${courseStructure.domain}/`;

      // Add cookies and referer to all video tasks
      for (const task of videoTasks) {
        task.cookies = cookieString;
        task.referer = refererUrl;
      }

      await downloadVideos(videoTasks, config);
    }

    console.log(chalk.green("\n✅ Sync complete!\n"));
    console.log(chalk.gray(`   Output: ${courseDir}\n`));
  } finally {
    await browser.close();
  }
}

/**
 * Maps LearningSuite video type to downloader video type.
 */
function mapVideoType(type: string): VideoDownloadTask["videoType"] {
  switch (type) {
    case "hls":
      return "highlevel"; // Use HLS downloader
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
 * Downloads videos with progress display.
 */
async function downloadVideos(
  videoTasks: VideoDownloadTask[],
  config: { concurrency: number }
): Promise<void> {
  const total = videoTasks.length;
  console.log(chalk.blue(`\n🎬 Downloading ${total} videos...\n`));

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

  const overallBar = multibar.create(total, 0, {
    typeTag: "[TOTAL]".padEnd(8),
    lessonName: `0/${total} completed`,
  });

  let completed = 0;
  let failed = 0;
  const errors: { name: string; error: string }[] = [];

  const activeBars = new Map<string, cliProgress.SingleBar>();
  const taskQueue = [...videoTasks];
  const activePromises = new Set<Promise<void>>();

  const processTask = async (task: VideoDownloadTask): Promise<void> => {
    const typeTag = task.videoType ? `[${task.videoType.toUpperCase()}]` : "[VIDEO]";
    const shortName =
      task.lessonName.length > 40 ? task.lessonName.substring(0, 37) + "..." : task.lessonName;

    const bar = multibar.create(100, 0, {
      typeTag: typeTag.padEnd(8),
      lessonName: shortName,
    });
    activeBars.set(task.lessonName, bar);

    try {
      const result = await downloadVideo(task, (progress) => {
        bar.update(Math.round(progress.percent));
      });

      if (!result.success) {
        errors.push({ name: task.lessonName, error: result.error ?? "Download failed" });
        failed++;
      } else {
        completed++;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push({ name: task.lessonName, error: errorMsg });
      failed++;
    } finally {
      multibar.remove(bar);
      activeBars.delete(task.lessonName);

      const done = completed + failed;
      overallBar.update(done, {
        lessonName: `${done}/${total} completed (${failed} failed)`,
      });
    }
  };

  while (taskQueue.length > 0 || activePromises.size > 0) {
    while (taskQueue.length > 0 && activePromises.size < config.concurrency) {
      const task = taskQueue.shift();
      if (task) {
        const promise = processTask(task).finally(() => {
          activePromises.delete(promise);
        });
        activePromises.add(promise);
      }
    }

    if (activePromises.size > 0) {
      await Promise.race(activePromises);
    }
  }

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
      console.log(chalk.red(`   - ${error.name}: ${error.error}`));
    }
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
  const lines: string[] = [];

  lines.push(`# ${title}`);
  lines.push("");

  if (description) {
    lines.push(description);
    lines.push("");
  }

  if (htmlContent) {
    lines.push("---");
    lines.push("");
    // Simple HTML to text conversion
    const text = htmlContent
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

    lines.push(text);
    lines.push("");
  }

  return lines.join("\n");
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
  console.log(chalk.cyan("\n🔓 LearningSuite Complete\n"));

  if (!isLearningSuitePortal(url)) {
    console.error(chalk.red("Error: URL does not appear to be a LearningSuite portal"));
    process.exit(1);
  }

  const domain = extractDomain(url);
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
        verifySession: hasValidLearningSuiteSession,
      },
      { headless: useHeadless }
    );
    browser = result.browser;
    session = result.session;
    spinner.succeed("Connected to LearningSuite");
  } catch (error) {
    spinner.fail("Failed to connect");
    console.log(chalk.red("\n❌ Authentication failed.\n"));
    if (error instanceof Error) {
      console.log(chalk.gray(`   Error: ${error.message}`));
    }
    process.exit(1);
  }

  try {
    // Scan course structure
    console.log(chalk.blue("\n📊 Scanning course structure...\n"));
    const courseStructure = await buildLearningSuiteCourseStructure(session.page, url);

    if (!courseStructure) {
      console.error(chalk.red("Failed to build course structure"));
      await browser.close();
      process.exit(1);
    }

    const totalLessons = courseStructure.modules.reduce((sum, mod) => sum + mod.lessons.length, 0);
    const completedLessons = courseStructure.modules.reduce(
      (sum, mod) => sum + mod.lessons.filter((l) => l.isCompleted).length,
      0
    );
    const lockedLessons = courseStructure.modules.reduce(
      (sum, mod) => sum + mod.lessons.filter((l) => l.isLocked).length,
      0
    );
    const incompleteLessons = totalLessons - completedLessons;

    console.log(
      chalk.gray(
        `   Found: ${totalLessons} lessons, ${completedLessons} completed, ${incompleteLessons} remaining`
      )
    );
    if (lockedLessons > 0) {
      console.log(chalk.yellow(`   Note: ${lockedLessons} lessons still locked`));
    }

    if (incompleteLessons === 0) {
      console.log(chalk.green("\n✅ All lessons are already completed!\n"));
      await browser.close();
      return;
    }

    console.log(chalk.blue(`\n🔓 Completing ${incompleteLessons} lessons...\n`));

    let totalCompleted = 0;
    const maxLessons = 1000; // Safety limit

    // Navigate to course page
    const courseUrl = `https://${courseStructure.domain}/student/course/${courseStructure.courseSlug ?? courseStructure.course.id}/${courseStructure.course.id}`;
    await session.page.goto(courseUrl, { waitUntil: "load" });

    // Wait for continue button to appear then click
    try {
      await session.page.waitForSelector('[data-cy="continue-lesson"]', { timeout: 8000 });
      await session.page.click('[data-cy="continue-lesson"]');
    } catch {
      console.log(chalk.gray(`   No lessons to complete.`));
      await browser.close();
      return;
    }

    // Wait for navigation to lesson page
    await session.page.waitForURL(/\/student\/course\/[^/]+\/[^/]+\/[^/]+\/[^/]+/);

    let lastUrl = "";

    while (totalCompleted < maxLessons) {
      const currentUrl = session.page.url();

      // Loop detection
      if (currentUrl === lastUrl) {
        console.log(chalk.gray(`   Detected loop, stopping.`));
        break;
      }
      lastUrl = currentUrl;

      // All in one evaluate: get title, check checkboxes, click button
      const result = await session.page.evaluate(() => {
        // Check any unchecked checkboxes
        document.querySelectorAll('input[type="checkbox"]:not(:checked)').forEach((cb) => {
          (cb as HTMLInputElement).click();
        });

        const breadcrumb = document.querySelector("nav li:last-child");
        const title = breadcrumb?.textContent?.trim() ?? "Unknown";
        const btn = document.querySelector<HTMLButtonElement>(
          "button.MuiButton-colorSuccess:not([disabled])"
        );

        if (btn) {
          btn.click();
          return { title, clicked: true };
        }
        return { title, clicked: false };
      });

      const shortName =
        result.title.length > 50 ? result.title.substring(0, 47) + "..." : result.title;
      process.stdout.write(chalk.gray(`   ⏳ ${shortName}...`));

      if (!result.clicked) {
        process.stdout.write(chalk.yellow(` locked/disabled\n`));
        break;
      }

      // Wait for URL to change (navigation to next lesson)
      try {
        await session.page.waitForURL((url) => url.href !== currentUrl);
        totalCompleted++;
        process.stdout.write(chalk.green(` ✓\n`));
      } catch {
        process.stdout.write(chalk.yellow(` no navigation\n`));
        break;
      }
    }

    if (totalCompleted > 0) {
      console.log(chalk.green(`\n   ✓ Marked ${totalCompleted} lessons as complete\n`));

      // Final re-scan to get updated structure
      console.log(chalk.gray(`   Re-scanning course structure...\n`));
      const updatedStructure = await buildLearningSuiteCourseStructure(session.page, url);
      if (updatedStructure) {
        const newCompletedLessons = updatedStructure.modules.reduce(
          (sum, mod) => sum + mod.lessons.filter((l) => l.isCompleted).length,
          0
        );
        const newTotalLessons = updatedStructure.modules.reduce(
          (sum, mod) => sum + mod.lessons.length,
          0
        );
        const percentage = Math.round((newCompletedLessons / newTotalLessons) * 100);
        console.log(
          chalk.gray(`   Progress: ${newCompletedLessons}/${newTotalLessons} (${percentage}%)`)
        );
      }
    } else {
      console.log(chalk.gray(`   No lessons needed completion.`));
    }

    console.log(chalk.green("\n✅ Complete finished!\n"));
  } finally {
    await browser.close();
  }
}
