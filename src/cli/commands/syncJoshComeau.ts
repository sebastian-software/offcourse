import chalk from "chalk";
import cliProgress from "cli-progress";
import ora from "ora";
import { basename } from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import { loadConfig } from "../../config/configManager.js";
import { downloadVideo } from "../../downloader/index.js";
import { getAuthenticatedSession } from "../../shared/auth.js";
import { pathExists } from "../../shared/fs.js";
import { parallelProcess } from "../../shared/parallelWorker.js";
import { createFolderName } from "../../shared/slug.js";
import { createShutdownManager } from "../../shared/shutdown.js";
import {
  buildJoshComeauCourseStructure,
  createJoshComeauSessionVerifier,
  downloadJoshComeauResource,
  extractJoshComeauLesson,
  formatJoshComeauMarkdown,
  isJoshComeauCourseUrl,
  isJoshComeauLoginPage,
  JOSH_COMEAU_DOMAIN,
  JOSH_COMEAU_LOGIN_URL,
  normalizeJoshComeauCourseUrl,
  rewriteJoshComeauResourceLinks,
  type JoshComeauCourseStructure,
  type JoshComeauLesson,
  type JoshComeauModule,
} from "../../scraper/joshcomeau/index.js";
import {
  createCourseDirectory,
  createModuleDirectory,
  getDownloadFilePath,
  getMarkdownPath,
  getVideoPath,
  saveMarkdown,
} from "../../storage/fileSystem.js";

const shutdown = createShutdownManager();

export interface SyncJoshComeauOptions {
  skipVideos?: boolean;
  skipContent?: boolean;
  dryRun?: boolean;
  limit?: number;
  force?: boolean;
  visible?: boolean;
  quality?: string;
  courseName?: string;
}

interface LessonTask {
  module: JoshComeauModule;
  lesson: JoshComeauLesson;
  moduleDir: string;
}

interface LessonResult {
  cached: boolean;
  contentSaved: boolean;
  resourcesDownloaded: number;
  videosDownloaded: number;
}

export { isJoshComeauCourseUrl };

function flattenLessons(structure: JoshComeauCourseStructure): JoshComeauLesson[] {
  return structure.modules.flatMap((module) => module.lessons);
}

function printCourseStructure(structure: JoshComeauCourseStructure): void {
  console.log(chalk.white(`\n   ${structure.name}\n`));
  for (const module of structure.modules) {
    console.log(chalk.cyan(`   ${String(module.number).padStart(2, "0")}. ${module.name}`));
    for (const lesson of module.lessons) {
      console.log(`      ${String(lesson.number).padStart(2, "0")}. ${lesson.name}`);
    }
  }
  console.log();
}

async function createAuthenticatedCourseSession(
  courseUrl: string,
  headless: boolean
): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  const result = await getAuthenticatedSession(
    {
      domain: JOSH_COMEAU_DOMAIN,
      loginUrl: JOSH_COMEAU_LOGIN_URL,
      isLoginPage: isJoshComeauLoginPage,
      verifySession: createJoshComeauSessionVerifier(courseUrl),
    },
    { headless }
  );

  return {
    browser: result.browser,
    context: result.session.context,
    page: result.session.page,
  };
}

async function buildLessonTasks(
  structure: JoshComeauCourseStructure,
  courseDir: string,
  limit?: number
): Promise<LessonTask[]> {
  const tasks: LessonTask[] = [];
  for (const module of structure.modules) {
    const moduleDir = await createModuleDirectory(courseDir, module.index, module.name);
    for (const lesson of module.lessons) tasks.push({ module, lesson, moduleDir });
  }
  return typeof limit === "number" ? tasks.slice(0, limit) : tasks;
}

function getJoshComeauVideoPath(
  moduleDir: string,
  lesson: JoshComeauLesson,
  videoIndex: number
): string {
  if (videoIndex === 0) return getVideoPath(moduleDir, lesson.index, lesson.name);
  return getDownloadFilePath(
    moduleDir,
    lesson.index,
    lesson.name,
    `video-${String(videoIndex + 1).padStart(2, "0")}.mp4`
  );
}

async function processLessons(
  context: BrowserContext,
  mainPage: Page,
  tasks: LessonTask[],
  options: SyncJoshComeauOptions,
  config: { extractionConcurrency: number; videoQuality: string }
): Promise<{ results: LessonResult[]; errors: { index: number; error: unknown }[] }> {
  const progressBar = new cliProgress.SingleBar(
    {
      format: "   {bar} {percentage}% | {value}/{total} | {status}",
      barCompleteChar: "█",
      barIncompleteChar: "░",
      barsize: 30,
      hideCursor: true,
    },
    cliProgress.Presets.shades_grey
  );
  progressBar.start(tasks.length, 0, { status: "Starting..." });
  let processed = 0;

  const result = await parallelProcess(
    context,
    mainPage,
    tasks,
    async (page, task) => {
      const { lesson, moduleDir } = task;
      const markdownPath = getMarkdownPath(moduleDir, lesson.index, lesson.name);
      const needsContent =
        !options.skipContent && ((options.force ?? false) || !(await pathExists(markdownPath)));

      if (options.skipVideos && !needsContent) {
        processed++;
        progressBar.update(processed, { status: lesson.name });
        return {
          cached: true,
          contentSaved: false,
          resourcesDownloaded: 0,
          videosDownloaded: 0,
        };
      }

      const content = await extractJoshComeauLesson(page, lesson.url);
      const videoPaths = content.videos.map((_video, index) =>
        getJoshComeauVideoPath(moduleDir, lesson, index)
      );
      let resourcesDownloaded = 0;
      let videosDownloaded = 0;

      if (needsContent) {
        const localResources = content.resources.map((resource) => ({
          url: resource.url,
          localFilename: basename(
            getDownloadFilePath(moduleDir, lesson.index, lesson.name, resource.filename)
          ),
        }));
        const offlineContent = {
          ...content,
          markdownContent: rewriteJoshComeauResourceLinks(content.markdownContent, localResources),
        };
        await saveMarkdown(
          moduleDir,
          createFolderName(lesson.index, lesson.name) + ".md",
          formatJoshComeauMarkdown(
            offlineContent,
            options.skipVideos ? [] : videoPaths.map((path) => basename(path))
          )
        );

        for (const resource of content.resources) {
          const outputPath = getDownloadFilePath(
            moduleDir,
            lesson.index,
            lesson.name,
            resource.filename
          );
          if (!options.force && (await pathExists(outputPath))) continue;
          const download = await downloadJoshComeauResource(
            page,
            resource.url,
            outputPath,
            lesson.url
          );
          if (!download.success) {
            throw new Error(
              `Resource ${resource.filename} failed: ${download.error ?? "unknown error"}`
            );
          }
          resourcesDownloaded++;
        }
      }

      if (!options.skipVideos) {
        for (const [index, video] of content.videos.entries()) {
          const outputPath = videoPaths[index];
          if (!outputPath || (!options.force && (await pathExists(outputPath)))) continue;
          if (!video.hlsUrl) {
            throw new Error(`Could not resolve Vimeo stream ${index + 1} for ${lesson.name}`);
          }

          const download = await downloadVideo({
            lessonId: lesson.number * 100 + index,
            lessonName:
              content.videos.length > 1 ? `${lesson.name} (video ${index + 1})` : lesson.name,
            videoUrl: video.hlsUrl,
            videoType: "hls",
            outputPath,
            preferredQuality: options.quality ?? config.videoQuality,
            referer: video.referer,
          });
          if (!download.success) {
            throw new Error(
              `Video ${index + 1} failed: ${download.error ?? "unknown download error"}`
            );
          }
          videosDownloaded++;
        }
      }

      processed++;
      const shortName = lesson.name.length > 42 ? `${lesson.name.slice(0, 39)}...` : lesson.name;
      progressBar.update(processed, { status: shortName });
      return {
        cached: !needsContent && resourcesDownloaded === 0 && videosDownloaded === 0,
        contentSaved: needsContent,
        resourcesDownloaded,
        videosDownloaded,
      };
    },
    {
      concurrency: Math.min(config.extractionConcurrency, Math.max(tasks.length, 1)),
      shouldContinue: shutdown.shouldContinue,
      onError: (_error, index) => {
        processed++;
        const lessonName = tasks[index]?.lesson.name ?? "Lesson";
        progressBar.update(processed, { status: `Failed: ${lessonName}` });
      },
    }
  );

  progressBar.stop();
  return result;
}

/** Downloads a Josh Comeau course for offline access. */
export async function syncJoshComeauCommand(
  url: string,
  options: SyncJoshComeauOptions
): Promise<void> {
  shutdown.setup();
  console.log(chalk.blue("\n📚 Josh Comeau Course Sync\n"));
  if (!isJoshComeauCourseUrl(url)) {
    throw new Error("Expected a supported Josh Comeau course or lesson URL");
  }

  const config = loadConfig();
  const courseUrl = normalizeJoshComeauCourseUrl(url);
  const useHeadless = options.visible ? false : config.headless;
  const authSpinner = ora("Connecting to Josh Comeau Courses...").start();
  let browser: Browser | undefined;

  try {
    const session = await createAuthenticatedCourseSession(courseUrl, useHeadless);
    browser = session.browser;
    shutdown.registerBrowser(browser);
    authSpinner.succeed("Authenticated with Josh Comeau Courses");

    const overviewSpinner = ora("Reading course curriculum...").start();
    const structure = await buildJoshComeauCourseStructure(session.page, courseUrl);
    if (options.courseName) structure.name = options.courseName;
    const totalLessons = flattenLessons(structure).length;
    overviewSpinner.succeed(
      `Found ${structure.modules.length} modules and ${totalLessons} lessons`
    );

    if (options.dryRun) {
      printCourseStructure(structure);
      return;
    }

    const courseDir = await createCourseDirectory(config.outputDir, structure.name);
    const lessonTasks = await buildLessonTasks(structure, courseDir, options.limit);
    if (options.limit) {
      console.log(chalk.yellow(`   Limiting sync to ${lessonTasks.length} lessons`));
    }
    console.log(chalk.gray(`   Output: ${courseDir}\n`));
    console.log(chalk.blue(`📝 Syncing ${lessonTasks.length} lessons...\n`));

    const extraction = await processLessons(
      session.context,
      session.page,
      lessonTasks,
      options,
      config
    );
    for (const extractionError of extraction.errors) {
      const lesson = lessonTasks[extractionError.index]?.lesson.name ?? "Unknown lesson";
      const message =
        extractionError.error instanceof Error
          ? extractionError.error.message
          : String(extractionError.error);
      console.error(chalk.red(`   ${lesson}: ${message}`));
    }
    if (extraction.errors.length > 0) {
      throw new Error(`${extraction.errors.length} Josh Comeau lesson(s) failed`);
    }

    const contentSaved = extraction.results.filter((result) => result.contentSaved).length;
    const cached = extraction.results.filter((result) => result.cached).length;
    const resources = extraction.results.reduce(
      (sum, result) => sum + result.resourcesDownloaded,
      0
    );
    const videos = extraction.results.reduce((sum, result) => sum + result.videosDownloaded, 0);
    console.log(chalk.green("\n✅ Josh Comeau sync complete!\n"));
    console.log(
      chalk.gray(`   Content: ${contentSaved} saved, ${resources} resources, ${cached} cached`)
    );
    if (!options.skipVideos) console.log(chalk.gray(`   Videos: ${videos} downloaded`));
    console.log(chalk.gray(`   Output: ${courseDir}\n`));
  } finally {
    if (browser) await browser.close();
  }
}
