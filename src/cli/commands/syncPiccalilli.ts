import chalk from "chalk";
import ora from "ora";
import { basename } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { loadConfig } from "../../config/configManager.js";
import type { VideoDownloadTask } from "../../downloader/index.js";
import { getAuthenticatedSession } from "../../shared/auth.js";
import { pathExists } from "../../shared/fs.js";
import { createFolderName } from "../../shared/slug.js";
import { createShutdownManager } from "../../shared/shutdown.js";
import {
  buildPiccalilliCourseStructure,
  createPiccalilliSessionVerifier,
  downloadPiccalilliResource,
  extractPiccalilliLesson,
  formatPiccalilliMarkdown,
  isPiccalilliCourseUrl,
  isPiccalilliLoginPage,
  normalizePiccalilliCourseUrl,
  PICCALILLI_DOMAIN,
  PICCALILLI_LOGIN_URL,
  rewritePiccalilliResourceLinks,
  type PiccalilliCourseStructure,
  type PiccalilliLesson,
  type PiccalilliModule,
} from "../../scraper/piccalilli/index.js";
import {
  createCourseDirectory,
  createModuleDirectory,
  getDownloadFilePath,
  getVideoPath,
  isLessonSynced,
  saveMarkdown,
} from "../../storage/fileSystem.js";
import { downloadVideoTasks, runParallelSyncStage } from "../syncPipeline.js";
import {
  initializeCourseState,
  LessonStatus,
  markLessonFailure,
  markLessonScanReady,
  recordVideoDownloadResult,
  type CourseDatabase,
  type LessonRecord,
} from "../../state/index.js";

const shutdown = createShutdownManager();

export interface SyncPiccalilliOptions {
  skipVideos?: boolean;
  skipContent?: boolean;
  dryRun?: boolean;
  limit?: number;
  force?: boolean;
  visible?: boolean;
  quality?: string;
  courseName?: string;
  retryFailed?: boolean;
}

interface LessonTask {
  module: PiccalilliModule;
  lesson: PiccalilliLesson;
  moduleDir: string;
  stateId: number;
}

interface LessonResult {
  cached: boolean;
  contentSaved: boolean;
  resourcesDownloaded: number;
  videoTask: VideoDownloadTask | null;
}

export { isPiccalilliCourseUrl };

function flattenLessons(structure: PiccalilliCourseStructure): PiccalilliLesson[] {
  return structure.modules.flatMap((module) => module.lessons);
}

function printCourseStructure(structure: PiccalilliCourseStructure): void {
  console.log(chalk.white(`\n   ${structure.name}\n`));
  for (const module of structure.modules) {
    console.log(chalk.cyan(`   ${String(module.number).padStart(2, "0")}. ${module.name}`));
    for (const lesson of module.lessons) {
      const access = lesson.isFree ? chalk.green("free") : chalk.gray("purchased");
      const duration = lesson.duration ? chalk.gray(` · ${lesson.duration}`) : "";
      console.log(
        `      ${String(lesson.number).padStart(2, "0")}. ${lesson.name} [${access}]${duration}`
      );
    }
  }
  console.log();
}

async function createPublicCourseSession(
  courseUrl: string,
  headless: boolean
): Promise<{
  browser: Browser;
  context: BrowserContext;
  page: Page;
  structure: PiccalilliCourseStructure;
}> {
  const browser = await chromium.launch({ headless });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const structure = await buildPiccalilliCourseStructure(page, courseUrl);
    return { browser, context, page, structure };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

async function createAuthenticatedCourseSession(
  courseUrl: string,
  headless: boolean
): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  const result = await getAuthenticatedSession(
    {
      domain: PICCALILLI_DOMAIN,
      loginUrl: PICCALILLI_LOGIN_URL,
      isLoginPage: isPiccalilliLoginPage,
      verifySession: createPiccalilliSessionVerifier(courseUrl),
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
  structure: PiccalilliCourseStructure,
  courseDir: string,
  lessonsByUrl: Map<string, LessonRecord>,
  limit?: number
): Promise<LessonTask[]> {
  const tasks: LessonTask[] = [];

  for (const module of structure.modules) {
    const moduleDir = await createModuleDirectory(courseDir, module.index, module.name);
    for (const lesson of module.lessons) {
      const stateLesson = lessonsByUrl.get(lesson.url);
      if (!stateLesson) throw new Error(`Missing state record for ${lesson.name}`);
      tasks.push({ module, lesson, moduleDir, stateId: stateLesson.id });
    }
  }

  return typeof limit === "number" ? tasks.slice(0, limit) : tasks;
}

async function processLessons(
  context: BrowserContext,
  mainPage: Page,
  tasks: LessonTask[],
  options: SyncPiccalilliOptions,
  config: { extractionConcurrency: number; videoQuality: string },
  database: CourseDatabase,
  retryLessonIds: Set<number>
): Promise<{ results: LessonResult[]; errors: { index: number; error: unknown }[] }> {
  const browserCookies = await context.cookies();
  const cookies = browserCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");

  return runParallelSyncStage({
    context,
    mainPage,
    tasks,
    concurrency: config.extractionConcurrency,
    shouldContinue: shutdown.shouldContinue,
    getTaskLabel: (task) => task.lesson.name,
    processTask: async (page, task) => {
      const { lesson, moduleDir, stateId } = task;
      const syncStatus = await isLessonSynced(moduleDir, lesson.index, lesson.name);
      const stateLesson = database.getLessonByUrl(lesson.url);
      const retryFailed = retryLessonIds.has(stateId);
      if (syncStatus.video && stateLesson?.status !== LessonStatus.DOWNLOADED) {
        database.markLessonDownloaded(stateId);
      }
      const force = options.force ?? false;
      const needsContent = !options.skipContent && (force || retryFailed || !syncStatus.content);
      const needsVideo =
        !options.skipVideos &&
        (force ||
          retryFailed ||
          (stateLesson?.status !== LessonStatus.DOWNLOADED && !syncStatus.video));

      if (!needsContent && !needsVideo) {
        return {
          cached: true,
          contentSaved: false,
          resourcesDownloaded: 0,
          videoTask: null,
        };
      }

      const content = await extractPiccalilliLesson(page, lesson.url);
      let resourcesDownloaded = 0;

      if (needsContent) {
        const localResources = content.resources.map((resource) => ({
          url: resource.url,
          localFilename: basename(
            getDownloadFilePath(moduleDir, lesson.index, lesson.name, resource.filename)
          ),
        }));
        const offlineContent = {
          ...content,
          markdownContent: rewritePiccalilliResourceLinks(content.markdownContent, localResources),
        };
        await saveMarkdown(
          moduleDir,
          createFolderName(lesson.index, lesson.name) + ".md",
          formatPiccalilliMarkdown(
            offlineContent,
            options.skipVideos
              ? undefined
              : basename(getVideoPath(moduleDir, lesson.index, lesson.name))
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

          const download = await downloadPiccalilliResource(
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

      let videoTask: VideoDownloadTask | null = null;
      if (needsVideo && content.video) {
        if (!content.video.hlsUrl) {
          throw new Error(`Could not resolve Bunny HLS playlist for ${lesson.name}`);
        }
        videoTask = {
          lessonId: stateId,
          lessonName: lesson.name,
          videoUrl: content.video.hlsUrl,
          videoType: "hls",
          outputPath: getVideoPath(moduleDir, lesson.index, lesson.name),
          preferredQuality: options.quality ?? config.videoQuality,
          cookies,
          referer: content.video.referer,
        };
        markLessonScanReady(database, stateId, videoTask);
      } else if (needsVideo) {
        database.markLessonSkipped(stateId, "No video found");
      }

      return {
        cached: false,
        contentSaved: needsContent,
        resourcesDownloaded,
        videoTask,
      };
    },
  });
}

/** Downloads a Piccalilli course for offline access. */
export async function syncPiccalilliCommand(
  url: string,
  options: SyncPiccalilliOptions
): Promise<void> {
  shutdown.setup();
  console.log(chalk.blue("\n📚 Piccalilli Course Sync\n"));

  if (!isPiccalilliCourseUrl(url)) {
    throw new Error("Expected a Piccalilli course overview or lesson URL");
  }

  const config = loadConfig();
  const courseUrl = normalizePiccalilliCourseUrl(url);
  const useHeadless = options.visible ? false : config.headless;
  const overviewSpinner = ora("Reading public course overview...").start();
  const publicSession = await createPublicCourseSession(courseUrl, useHeadless);
  const structure = publicSession.structure;
  if (options.courseName) structure.name = options.courseName;
  const totalLessons = flattenLessons(structure).length;
  overviewSpinner.succeed(`Found ${structure.modules.length} modules and ${totalLessons} lessons`);

  if (options.dryRun) {
    printCourseStructure(structure);
    await publicSession.browser.close();
    return;
  }

  const allLessons = flattenLessons(structure);
  const selectedLessons =
    typeof options.limit === "number" ? allLessons.slice(0, options.limit) : allLessons;
  const needsAuthentication = selectedLessons.some((lesson) => !lesson.isFree);
  let browser: Browser | undefined = publicSession.browser;
  let database: CourseDatabase | undefined;
  const closeDatabase = () => {
    if (database) {
      database.close();
      database = undefined;
    }
  };

  try {
    let session: { browser: Browser; context: BrowserContext; page: Page } = publicSession;
    if (needsAuthentication) {
      await publicSession.browser.close();
      const authSpinner = ora("Connecting to Piccalilli...").start();
      try {
        session = await createAuthenticatedCourseSession(courseUrl, useHeadless);
        browser = session.browser;
        authSpinner.succeed("Authenticated with Piccalilli");
      } catch (error) {
        authSpinner.fail("Piccalilli login failed");
        throw error;
      }
    } else {
      console.log(chalk.gray("   Selected lessons are public; login not required"));
    }

    shutdown.registerBrowser(browser);

    const state = initializeCourseState(
      "piccalilli",
      courseUrl,
      {
        name: structure.name,
        url: structure.url,
        modules: structure.modules.map((module) => ({
          slug: module.slug,
          name: module.name,
          position: module.index,
          lessons: module.lessons.map((lesson) => ({
            slug: lesson.slug,
            name: lesson.name,
            url: lesson.url,
            position: lesson.index,
          })),
        })),
      },
      options
    );
    database = state.database;
    shutdown.registerCleanup(closeDatabase);
    console.log(chalk.gray(`   State: ~/.offcourse/cache/${state.key}.db`));

    const courseDir = await createCourseDirectory(config.outputDir, structure.name);
    const lessonTasks = await buildLessonTasks(
      structure,
      courseDir,
      state.lessonsByUrl,
      options.limit
    );
    if (options.limit) {
      console.log(chalk.yellow(`   Limiting sync to ${lessonTasks.length} lessons`));
    }
    console.log(chalk.gray(`   Output: ${courseDir}\n`));

    console.log(chalk.blue(`📝 Extracting ${lessonTasks.length} lessons...\n`));
    const extraction = await processLessons(
      session.context,
      session.page,
      lessonTasks,
      options,
      config,
      database,
      state.retryLessonIds
    );

    if (!shutdown.shouldContinue()) return;

    const videoTasks = extraction.results.flatMap((result) =>
      result.videoTask ? [result.videoTask] : []
    );
    const contentSaved = extraction.results.filter((result) => result.contentSaved).length;
    const cached = extraction.results.filter((result) => result.cached).length;
    const resources = extraction.results.reduce(
      (sum, result) => sum + result.resourcesDownloaded,
      0
    );
    console.log(
      chalk.gray(
        `   Content: ${contentSaved} saved, ${resources} resources, ${cached} cached, ${extraction.errors.length} failed`
      )
    );

    const downloads = options.skipVideos
      ? { completed: 0, failures: [], outcomes: [] }
      : await downloadVideoTasks(videoTasks, {
          concurrency: config.concurrency,
          shouldContinue: shutdown.shouldContinue,
        });
    for (const extractionError of extraction.errors) {
      const lessonTask = lessonTasks[extractionError.index];
      const lesson = lessonTask?.lesson.name ?? "Unknown lesson";
      const message =
        extractionError.error instanceof Error
          ? extractionError.error.message
          : String(extractionError.error);
      if (lessonTask) {
        markLessonFailure(database, lessonTask.stateId, extractionError.error, "EXTRACTION_ERROR");
      }
      console.error(chalk.red(`   ${lesson}: ${message}`));
    }
    for (const outcome of downloads.outcomes) {
      recordVideoDownloadResult(database, outcome.task, outcome.result, outcome.error);
    }

    const failureCount = extraction.errors.length + downloads.failures.length;
    if (failureCount > 0) {
      throw new Error(`${failureCount} Piccalilli lesson(s) failed`);
    }

    console.log(chalk.green("\n✅ Piccalilli sync complete!\n"));
    if (!options.skipVideos) {
      console.log(chalk.gray(`   Videos: ${downloads.completed} downloaded`));
    }
    console.log(chalk.gray(`   Output: ${courseDir}\n`));
  } finally {
    closeDatabase();
    if (browser) await browser.close();
  }
}
