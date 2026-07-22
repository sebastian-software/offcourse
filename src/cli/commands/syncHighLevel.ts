import chalk from "chalk";
import ora from "ora";
import { loadConfig } from "../../config/configManager.js";
import type { VideoDownloadTask } from "../../downloader/index.js";
import {
  getAuthenticatedSession,
  hasValidFirebaseToken,
  isHighLevelLoginPage,
} from "../../shared/auth.js";
import { createShutdownManager } from "../../shared/shutdown.js";
import {
  buildHighLevelCourseStructure,
  createFolderName,
  extractHighLevelPostContent,
  getHighLevelPostUrl,
  type HighLevelCourseStructure,
  type HighLevelScanProgress,
} from "../../scraper/highlevel/index.js";
import {
  createCourseDirectory,
  createModuleDirectory,
  getDownloadFilePath,
  getVideoPath,
  saveMarkdown,
  isLessonSynced,
  downloadFile,
} from "../../storage/fileSystem.js";
import { slugify as createSlug } from "../../scraper/highlevel/navigator.js";
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

export interface SyncHighLevelOptions {
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

/**
 * Extracts the domain from a HighLevel portal URL.
 */
function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Detects if a URL is a HighLevel portal (HighLevel, ClientClub, etc.).
 */
export function isHighLevelPortal(url: string): boolean {
  // Known HighLevel portal patterns
  const portalPatterns = [
    /member\.[^/]+\.com/,
    /portal\.[^/]+\.com/,
    /courses\.[^/]+\.com/,
    /clientclub\.net/,
    /\.highlevel\.io/,
    /\.leadconnectorhq\.com/,
  ];

  // Check URL patterns
  if (portalPatterns.some((p) => p.test(url))) {
    return true;
  }

  // Check if URL contains Memberships course path pattern
  if (/\/courses\/(products|library|classroom)/i.test(url)) {
    return true;
  }

  return false;
}

/**
 * Handles HighLevel course synchronization.
 * Downloads all content from a HighLevel portal (HighLevel, ClientClub, etc.).
 */
export async function syncHighLevelCommand(
  url: string,
  options: SyncHighLevelOptions
): Promise<void> {
  shutdown.setup();

  console.log(chalk.blue("\n📚 HighLevel Course Sync\n"));

  const config = loadConfig();
  const domain = extractDomain(url);

  console.log(chalk.gray(`   Portal: ${domain}`));

  // Determine portal URL - use the course URL to trigger login if needed
  const portalUrl = url;

  // Get authenticated session
  const useHeadless = options.visible ? false : config.headless;
  const spinner = ora("Connecting to portal...").start();

  let browser;
  let session;
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
        loginUrl: portalUrl,
        isLoginPage: isHighLevelLoginPage,
        verifySession: hasValidFirebaseToken,
      },
      { headless: useHeadless }
    );
    browser = result.browser;
    session = result.session;
    shutdown.registerBrowser(browser);
    const sessionInfo = result.usedCachedSession ? " (cached session)" : "";
    spinner.succeed(`Connected to portal${sessionInfo}`);
  } catch (error) {
    if (shutdown.isShuttingDown()) return;

    spinner.fail("Failed to connect");
    console.log(chalk.red("\n❌ Authentication failed.\n"));
    console.log(chalk.gray(`   Tried to authenticate with: ${portalUrl}`));
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

    console.log(chalk.blue("\n📖 Scanning course structure...\n"));

    // Build course structure (handles navigation internally to capture API responses)
    let courseStructure: HighLevelCourseStructure | null = null;
    let progressBar: ReturnType<typeof createSyncProgressBar> | undefined;

    try {
      courseStructure = await buildHighLevelCourseStructure(
        session.page,
        url,
        (progress: HighLevelScanProgress) => {
          if (progress.phase === "course" && progress.courseName) {
            console.log(chalk.white(`   Course: ${progress.courseName}`));
          } else if (progress.phase === "categories" && progress.totalCategories) {
            progressBar = createSyncProgressBar();
            progressBar.start(progress.totalCategories, 0, { status: "Scanning categories..." });
          } else if (progress.phase === "posts") {
            if (progress.skippedLocked) {
              progressBar?.increment({ status: `🔒 ${progress.currentCategory ?? "Locked"}` });
            } else if (progress.postsFound !== undefined) {
              progressBar?.increment({
                status: `${progress.currentCategory ?? "Category"} (${progress.postsFound} lessons)`,
              });
            } else {
              const categoryName = progress.currentCategory ?? "";
              const shortName =
                categoryName.length > 35 ? categoryName.substring(0, 32) + "..." : categoryName;
              progressBar?.update(progress.currentCategoryIndex ?? 0, { status: shortName });
            }
          } else if (progress.phase === "done") {
            progressBar?.stop();
          }
        }
      );
    } catch (error) {
      if (shutdown.isShuttingDown()) {
        progressBar?.stop();
        return;
      }

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
      console.log(chalk.gray("   - The portal is not a supported HighLevel portal"));
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
    const totalLessons = courseStructure.categories.reduce((sum, cat) => sum + cat.posts.length, 0);
    const lockedCategories = courseStructure.categories.filter((c) => c.isLocked).length;

    console.log();
    const parts: string[] = [];
    parts.push(`${courseStructure.categories.length} modules`);
    parts.push(`${totalLessons} lessons`);
    if (lockedCategories > 0) parts.push(chalk.yellow(`${lockedCategories} locked`));
    console.log(`   Found: ${parts.join(", ")}`);

    if (options.dryRun) {
      printCourseStructure(courseStructure);
      await browser.close();
      return;
    }

    const canonicalCourseUrl = `https://${courseStructure.domain}/courses/products/${courseStructure.course.id}`;
    const state = initializeCourseState(
      "highlevel",
      canonicalCourseUrl,
      {
        name: courseStructure.course.title,
        url: canonicalCourseUrl,
        modules: courseStructure.categories.map((category, categoryIndex) => ({
          slug: category.id,
          name: category.title,
          position: categoryIndex,
          isLocked: category.isLocked,
          lessons: category.posts.map((post, postIndex) => ({
            slug: post.id,
            name: post.title,
            url: getHighLevelPostUrl(
              courseStructure.domain,
              courseStructure.course.id,
              category.id,
              post.id
            ),
            position: postIndex,
            isLocked: post.isLocked,
          })),
        })),
      },
      options
    );
    database = state.database;
    shutdown.registerCleanup(closeDatabase);
    console.log(chalk.gray(`   State: ~/.offcourse/cache/${state.key}.db`));

    // Create course directory
    const courseSlug = createSlug(courseStructure.course.title);
    const courseDir = await createCourseDirectory(config.outputDir, courseSlug);
    console.log(chalk.gray(`\n📁 Output: ${courseDir}\n`));

    // Process lessons - build task list first, then process in parallel
    const videoTasks: VideoDownloadTask[] = [];
    let contentExtracted = 0;
    let skipped = 0;

    // Build list of posts to process with their metadata
    interface PostTask {
      post: (typeof courseStructure.categories)[0]["posts"][0];
      postIndex: number;
      category: (typeof courseStructure.categories)[0];
      categoryIndex: number;
      moduleDir: string;
      postUrl: string;
      stateId: number;
    }
    const postTasks: PostTask[] = [];

    // Build task list and create module directories
    for (const [catIndex, category] of courseStructure.categories.entries()) {
      if (category.isLocked) continue;

      const moduleDir = await createModuleDirectory(courseDir, catIndex, category.title);

      for (const [postIndex, post] of category.posts.entries()) {
        const postUrl = getHighLevelPostUrl(
          courseStructure.domain,
          courseStructure.course.id,
          category.id,
          post.id
        );
        const stateLesson = state.lessonsByUrl.get(postUrl);
        if (!stateLesson) throw new Error(`Missing state record for ${post.title}`);
        postTasks.push({
          post,
          postIndex,
          category,
          categoryIndex: catIndex,
          moduleDir,
          postUrl,
          stateId: stateLesson.id,
        });
      }
    }

    // Apply limit
    const lessonLimit = options.limit;
    let totalToProcess = postTasks.length;
    if (lessonLimit) {
      totalToProcess = Math.min(postTasks.length, lessonLimit);
      postTasks.splice(lessonLimit); // Trim to limit
      console.log(chalk.yellow(`   Limiting to ${totalToProcess} lessons\n`));
    }

    // Phase 2: Extract content and queue downloads (parallel)
    const extractionConcurrency = config.extractionConcurrency;
    const phase2Label = options.skipContent
      ? `🎬 Scanning ${totalToProcess} lessons for videos (${extractionConcurrency}x parallel)...`
      : `📝 Extracting content for ${totalToProcess} lessons (${extractionConcurrency}x parallel)...`;
    console.log(chalk.blue(`\n${phase2Label}\n`));

    const resultsLock = { videoTasks, contentExtracted: 0, skipped: 0 };

    // Worker function to process a single post
    const processPost = async (page: import("playwright").Page, task: PostTask): Promise<void> => {
      const { post, postIndex, category, moduleDir, postUrl, stateId } = task;

      try {
        const syncStatus = await isLessonSynced(moduleDir, postIndex, post.title);
        const stateLesson = database?.getLessonByUrl(postUrl);
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
        const content = await extractHighLevelPostContent(
          page,
          postUrl,
          courseStructure.locationId,
          courseStructure.course.id,
          post.id,
          category.id
        );

        if (!content) throw new Error(`Could not extract ${post.title}`);

        // Save markdown if needed
        if (needsContent) {
          const markdown = formatHighLevelMarkdown(
            content.title,
            content.description,
            content.htmlContent,
            content.video?.url
          );

          await saveMarkdown(moduleDir, createFolderName(postIndex, post.title) + ".md", markdown);

          // Download attachments
          for (const attachment of content.attachments) {
            if (attachment.url) {
              const attachmentPath = getDownloadFilePath(
                moduleDir,
                postIndex,
                post.title,
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
          const videoTask: VideoDownloadTask = {
            lessonId: stateId,
            lessonName: post.title,
            videoUrl: content.video.url,
            videoType:
              content.video.type === "hls"
                ? "highlevel"
                : (content.video.type as VideoDownloadTask["videoType"]),
            outputPath: getVideoPath(moduleDir, postIndex, post.title),
            preferredQuality: options.quality,
          };
          resultsLock.videoTasks.push(videoTask);
          if (database) markLessonScanReady(database, stateId, videoTask);
        } else if (needsVideo) {
          database?.markLessonSkipped(stateId, "No video found");
        }
      } catch (error) {
        if (database) markLessonFailure(database, stateId, error, "EXTRACTION_ERROR");
        const shortName = post.title.length > 30 ? post.title.substring(0, 27) + "..." : post.title;
        console.error(`\n   ⚠️ Error: ${shortName}`);
      }
    };

    await runParallelSyncStage({
      context: session.context,
      mainPage: session.page,
      tasks: postTasks,
      concurrency: extractionConcurrency,
      shouldContinue: shutdown.shouldContinue,
      processTask: processPost,
      getTaskLabel: (task) => task.post.title,
    });

    // Update counters from results lock
    contentExtracted = resultsLock.contentExtracted;
    skipped = resultsLock.skipped;

    // Print content summary
    console.log();
    const contentParts: string[] = [];
    if (contentExtracted > 0) contentParts.push(chalk.green(`${contentExtracted} extracted`));
    if (skipped > 0) contentParts.push(chalk.gray(`${skipped} cached`));
    console.log(`   Content: ${contentParts.join(", ")}`);

    // Phase 3: Download videos
    if (!options.skipVideos && videoTasks.length > 0) {
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
    console.log(chalk.gray(`   Output: ${courseDir}\n`));
  } finally {
    closeDatabase();
    await browser.close();
  }
}

/**
 * Format markdown content for HighLevel posts.
 */
export function formatHighLevelMarkdown(
  title: string,
  description: string | null,
  htmlContent: string | null,
  videoUrl?: string
): string {
  return formatHtmlLessonMarkdown({ title, description, htmlContent, videoUrl });
}

/**
 * Print course structure (for dry-run mode).
 */
function printCourseStructure(structure: HighLevelCourseStructure): void {
  console.log(chalk.cyan("\n📋 Course Structure\n"));
  console.log(chalk.white(`   ${structure.course.title}`));
  console.log(chalk.gray(`   Location: ${structure.locationId}`));
  console.log(chalk.gray(`   Domain: ${structure.domain}`));
  console.log();

  for (const [i, category] of structure.categories.entries()) {
    const lockedTag = category.isLocked ? chalk.yellow(" [LOCKED]") : "";
    console.log(chalk.white(`   ${String(i + 1).padStart(2)}. ${category.title}${lockedTag}`));

    for (const [j, post] of category.posts.slice(0, 5).entries()) {
      console.log(chalk.gray(`       ${String(j + 1).padStart(2)}. ${post.title}`));
    }

    if (category.posts.length > 5) {
      console.log(chalk.gray(`       ... and ${category.posts.length - 5} more`));
    }
    console.log();
  }
}
