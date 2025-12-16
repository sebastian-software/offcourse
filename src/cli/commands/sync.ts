import chalk from "chalk";
import ora from "ora";
import { loadConfig } from "../../config/configManager.js";
import { downloadVideo, AsyncQueue, type VideoDownloadTask } from "../../downloader/index.js";
import { getAuthenticatedSession } from "../../scraper/auth.js";
import { extractLessonContent, formatMarkdown } from "../../scraper/extractor.js";
import { buildCourseStructure } from "../../scraper/navigator.js";
import {
  createCourseDirectory,
  createLessonDirectory,
  createModuleDirectory,
  getVideoPath,
  isLessonSynced,
  saveMarkdown,
} from "../../storage/fileSystem.js";

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

        // Save markdown content if needed
        if (needsContent) {
          const markdown = formatMarkdown(
            content.title,
            content.markdownContent,
            content.videoUrl,
            content.videoType
          );
          saveMarkdown(task.lessonDir, "content.md", markdown);
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

      const queue = new AsyncQueue<VideoDownloadTask>({
        concurrency: config.concurrency,
        maxRetries: config.retryAttempts,
      });

      queue.addAll(videoTasks.map((task) => ({ id: task.lessonName, data: task })));

      const videoSpinner = ora("Starting downloads...").start();

      const result = await queue.process(async (task, id) => {
        videoSpinner.text = `   Downloading: ${id}`;

        const downloadResult = await downloadVideo(task, (progress) => {
          videoSpinner.text = `   ${id} (${Math.round(progress.percent)}%)`;
        });

        if (!downloadResult.success) {
          throw new Error(downloadResult.error ?? "Download failed");
        }
      });

      videoSpinner.succeed(`   Videos: ${result.completed} downloaded, ${result.failed} failed`);

      if (result.errors.length > 0) {
        console.log(chalk.yellow("\n   Failed downloads:"));
        for (const error of result.errors) {
          console.log(chalk.red(`   - ${error.id}: ${error.error}`));
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
