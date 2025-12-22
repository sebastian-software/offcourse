import chalk from "chalk";
import cliProgress from "cli-progress";
import ora from "ora";
import { join } from "node:path";
import { loadConfig } from "../../config/configManager.js";
import { downloadVideo, type VideoDownloadTask } from "../../downloader/index.js";
import {
  getAuthenticatedSession,
  hasValidFirebaseToken,
  isHighLevelLoginPage,
} from "../../shared/auth.js";
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
  getVideoPath,
  saveMarkdown,
  isLessonSynced,
  downloadFile,
} from "../../storage/fileSystem.js";
import { slugify as createSlug } from "../../scraper/highlevel/navigator.js";

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

interface SyncHighLevelOptions {
  skipVideos?: boolean;
  skipContent?: boolean;
  dryRun?: boolean;
  limit?: number;
  visible?: boolean;
  quality?: string;
  courseName?: string;
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
 * Handles the sync-memberships command.
 * Downloads all content from a HighLevel portal (HighLevel, ClientClub, etc.).
 */
export async function syncHighLevelCommand(
  url: string,
  options: SyncHighLevelOptions
): Promise<void> {
  setupShutdownHandlers();

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
    cleanupResources.browser = browser;
    spinner.succeed("Connected to portal");
  } catch (error) {
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
    if (!shouldContinue()) {
      return;
    }

    console.log(chalk.blue("\n📖 Scanning course structure...\n"));

    // Build course structure (handles navigation internally to capture API responses)
    let courseStructure: HighLevelCourseStructure | null = null;
    let progressBar: cliProgress.SingleBar | undefined;

    try {
      courseStructure = await buildHighLevelCourseStructure(
        session.page,
        url,
        (progress: HighLevelScanProgress) => {
          if (progress.phase === "course" && progress.courseName) {
            console.log(chalk.white(`   Course: ${progress.courseName}`));
          } else if (progress.phase === "categories" && progress.totalCategories) {
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

    // Create course directory
    const courseSlug = createSlug(courseStructure.course.title);
    const courseDir = await createCourseDirectory(config.outputDir, courseSlug);
    console.log(chalk.gray(`\n📁 Output: ${courseDir}\n`));

    // Process lessons
    const videoTasks: VideoDownloadTask[] = [];
    let contentExtracted = 0;
    let skipped = 0;
    let processed = 0;

    // Apply limit
    const lessonLimit = options.limit;
    let totalToProcess = totalLessons;
    if (lessonLimit) {
      totalToProcess = Math.min(totalLessons, lessonLimit);
      console.log(chalk.yellow(`   Limiting to ${totalToProcess} lessons\n`));
    }

    // Phase 2: Extract content and queue downloads
    console.log(chalk.blue(`\n📝 Extracting content for ${totalToProcess} lessons...\n`));

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

    for (let catIndex = 0; catIndex < courseStructure.categories.length; catIndex++) {
      if (!shouldContinue()) break;
      if (lessonLimit && processed >= lessonLimit) break;

      const category = courseStructure.categories[catIndex]!;
      if (category.isLocked) {
        continue;
      }

      const moduleDir = await createModuleDirectory(courseDir, catIndex, category.title);

      for (let postIndex = 0; postIndex < category.posts.length; postIndex++) {
        if (!shouldContinue()) break;
        if (lessonLimit && processed >= lessonLimit) break;

        const post = category.posts[postIndex]!;

        const shortName = post.title.length > 40 ? post.title.substring(0, 37) + "..." : post.title;
        contentProgressBar.update(processed, { status: shortName });

        // Check if already synced
        const syncStatus = await isLessonSynced(moduleDir, postIndex, post.title);

        if (!options.skipContent && !syncStatus.content) {
          try {
            // Get full post URL
            const postUrl = getHighLevelPostUrl(
              courseStructure.domain,
              courseStructure.course.id,
              category.id,
              post.id
            );

            // Extract content
            const content = await extractHighLevelPostContent(
              session.page,
              postUrl,
              courseStructure.locationId,
              courseStructure.course.id,
              post.id,
              category.id
            );

            if (content) {
              // Save markdown
              const markdown = formatHighLevelMarkdown(
                content.title,
                content.description,
                content.htmlContent,
                content.video?.url
              );

              await saveMarkdown(
                moduleDir,
                createFolderName(postIndex, post.title) + ".md",
                markdown
              );

              // Download attachments
              for (const attachment of content.attachments) {
                if (attachment.url) {
                  const attachmentPath = join(
                    moduleDir,
                    `${createFolderName(postIndex, post.title)}-${attachment.name}`
                  );
                  await downloadFile(attachment.url, attachmentPath);
                }
              }

              // Queue video download
              if (!options.skipVideos && !syncStatus.video && content.video?.url) {
                videoTasks.push({
                  lessonId: post.id as unknown as number, // Using string ID
                  lessonName: post.title,
                  videoUrl: content.video.url,
                  videoType:
                    content.video.type === "hls"
                      ? "highlevel"
                      : (content.video.type as VideoDownloadTask["videoType"]),
                  outputPath: getVideoPath(moduleDir, postIndex, post.title),
                  preferredQuality: options.quality,
                });
              }

              contentExtracted++;
            }
          } catch (error) {
            console.error(`\nError extracting ${post.title}:`, error);
          }
        } else {
          skipped++;

          // Still queue video if content was skipped but video not downloaded
          if (!options.skipVideos && !syncStatus.video) {
            // We need to get the video URL
            try {
              const postUrl = getHighLevelPostUrl(
                courseStructure.domain,
                courseStructure.course.id,
                category.id,
                post.id
              );

              const content = await extractHighLevelPostContent(
                session.page,
                postUrl,
                courseStructure.locationId,
                courseStructure.course.id,
                post.id,
                category.id
              );

              if (content?.video?.url) {
                videoTasks.push({
                  lessonId: post.id as unknown as number,
                  lessonName: post.title,
                  videoUrl: content.video.url,
                  videoType:
                    content.video.type === "hls"
                      ? "highlevel"
                      : (content.video.type as VideoDownloadTask["videoType"]),
                  outputPath: getVideoPath(moduleDir, postIndex, post.title),
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
    console.log(`   Content: ${contentParts.join(", ")}`);

    // Phase 3: Download videos
    if (!options.skipVideos && videoTasks.length > 0) {
      await downloadVideos(videoTasks, config);
    }

    console.log(chalk.green("\n✅ Sync complete!\n"));
    console.log(chalk.gray(`   Output: ${courseDir}\n`));
  } finally {
    await browser.close();
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
 * Format markdown content for HighLevel posts.
 */
export function formatHighLevelMarkdown(
  title: string,
  description: string | null,
  htmlContent: string | null,
  videoUrl?: string
): string {
  const lines: string[] = [];

  lines.push(`# ${title}`);
  lines.push("");

  if (description) {
    lines.push(description);
    lines.push("");
  }

  if (videoUrl) {
    lines.push("## Video");
    lines.push("");
    lines.push(`Video URL: ${videoUrl}`);
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
function printCourseStructure(structure: HighLevelCourseStructure): void {
  console.log(chalk.cyan("\n📋 Course Structure\n"));
  console.log(chalk.white(`   ${structure.course.title}`));
  console.log(chalk.gray(`   Location: ${structure.locationId}`));
  console.log(chalk.gray(`   Domain: ${structure.domain}`));
  console.log();

  for (let i = 0; i < structure.categories.length; i++) {
    const category = structure.categories[i]!;
    const lockedTag = category.isLocked ? chalk.yellow(" [LOCKED]") : "";
    console.log(chalk.white(`   ${String(i + 1).padStart(2)}. ${category.title}${lockedTag}`));

    for (let j = 0; j < Math.min(category.posts.length, 5); j++) {
      const post = category.posts[j]!;
      console.log(chalk.gray(`       ${String(j + 1).padStart(2)}. ${post.title}`));
    }

    if (category.posts.length > 5) {
      console.log(chalk.gray(`       ... and ${category.posts.length - 5} more`));
    }
    console.log();
  }
}
