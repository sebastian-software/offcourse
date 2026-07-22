import chalk from "chalk";
import ora from "ora";
import { basename } from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import { loadConfig } from "../../config/configManager.js";
import type { VideoDownloadTask } from "../../downloader/index.js";
import { getAuthenticatedSession } from "../../shared/auth.js";
import { pathExists } from "../../shared/fs.js";
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
  getVideoPath,
  isLessonSynced,
  saveMarkdown,
} from "../../storage/fileSystem.js";
import { runParallelSyncStage } from "../syncPipeline.js";
import { downloadVideoTasks } from "../syncPipeline.js";
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

export interface SyncJoshComeauOptions {
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
  module: JoshComeauModule;
  lesson: JoshComeauLesson;
  moduleDir: string;
  stateId: number;
}

interface LessonResult {
  cached: boolean;
  contentSaved: boolean;
  resourcesDownloaded: number;
  videosDownloaded: number;
  stateId: number;
  videoTasks: VideoDownloadTask[];
  expectedVideoCount: number;
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
    { headless, useStandardBrowserUserAgent: true }
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
  config: { extractionConcurrency: number; concurrency: number; videoQuality: string },
  getDatabase: () => CourseDatabase | undefined,
  retryLessonIds: Set<number>
): Promise<{ results: LessonResult[]; errors: { index: number; error: unknown }[] }> {
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
      const stateLesson = getDatabase()?.getLessonByUrl(lesson.url);
      const retryFailed = retryLessonIds.has(stateId);
      const needsContent =
        !options.skipContent && ((options.force ?? false) || retryFailed || !syncStatus.content);
      const needsVideo =
        !options.skipVideos &&
        ((options.force ?? false) ||
          retryFailed ||
          stateLesson?.status !== LessonStatus.DOWNLOADED);

      if (!needsContent && !needsVideo) {
        return {
          cached: true,
          contentSaved: false,
          resourcesDownloaded: 0,
          videosDownloaded: 0,
          stateId,
          videoTasks: [],
          expectedVideoCount: 0,
        };
      }

      const content = await extractJoshComeauLesson(page, lesson.url);
      const videoPaths = content.videos.map((_video, index) =>
        getJoshComeauVideoPath(moduleDir, lesson, index)
      );
      let resourcesDownloaded = 0;
      const videoTasks: VideoDownloadTask[] = [];
      let expectedVideoCount = 0;

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

      if (needsVideo) {
        for (const [index, video] of content.videos.entries()) {
          const outputPath = videoPaths[index];
          if (!outputPath || (!options.force && !retryFailed && (await pathExists(outputPath)))) {
            continue;
          }
          expectedVideoCount++;
          if (!shutdown.shouldContinue()) break;
          if (!video.hlsUrl) {
            throw new Error(`Could not resolve Vimeo stream ${index + 1} for ${lesson.name}`);
          }

          const videoTask: VideoDownloadTask = {
            lessonId: stateId,
            lessonName:
              content.videos.length > 1 ? `${lesson.name} (video ${index + 1})` : lesson.name,
            videoUrl: video.hlsUrl,
            videoType: "hls",
            outputPath,
            preferredQuality: options.quality ?? config.videoQuality,
            referer: video.referer,
          } as const;
          const database = getDatabase();
          if (!database) break;
          markLessonScanReady(database, stateId, videoTask);
          videoTasks.push(videoTask);
        }
        if (!shutdown.shouldContinue()) {
          return {
            cached: false,
            contentSaved: needsContent,
            resourcesDownloaded,
            videosDownloaded: 0,
            stateId,
            videoTasks,
            expectedVideoCount,
          };
        }
        if (content.videos.length === 0) {
          getDatabase()?.markLessonSkipped(stateId, "No video found");
        }
      }

      return {
        cached: !needsContent && resourcesDownloaded === 0 && videoTasks.length === 0,
        contentSaved: needsContent,
        resourcesDownloaded,
        videosDownloaded: 0,
        stateId,
        videoTasks,
        expectedVideoCount,
      };
    },
  });
}

function recordJoshVideoDownloads(
  database: CourseDatabase,
  results: LessonResult[],
  summary: Awaited<ReturnType<typeof downloadVideoTasks>>
): number {
  for (const outcome of summary.outcomes) {
    if (outcome.error || !outcome.result?.success) {
      recordVideoDownloadResult(database, outcome.task, outcome.result, outcome.error);
    }
  }

  let videosDownloaded = 0;
  for (const result of results) {
    if (result.expectedVideoCount === 0) continue;

    const outcomes = result.videoTasks.map((task) =>
      summary.outcomes.find((outcome) => outcome.task.outputPath === task.outputPath)
    );
    const hasFailure = outcomes.some(
      (outcome) => outcome !== undefined && (outcome.error ?? !outcome.result?.success)
    );
    if (hasFailure) continue;

    if (
      result.videoTasks.length !== result.expectedVideoCount ||
      outcomes.some((outcome) => outcome === undefined)
    ) {
      markLessonFailure(
        database,
        result.stateId,
        new Error("Video download interrupted before all lesson videos completed"),
        "DOWNLOAD_INTERRUPTED"
      );
      continue;
    }

    if (outcomes.length === 0) {
      database.markLessonDownloaded(result.stateId);
    } else {
      const firstSuccess = outcomes[0];
      if (firstSuccess?.result?.success) {
        recordVideoDownloadResult(database, firstSuccess.task, firstSuccess.result);
      }
    }
    videosDownloaded += outcomes.length;
  }

  return videosDownloaded;
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
  let database: CourseDatabase | undefined;
  const closeDatabase = () => {
    if (database) {
      database.close();
      database = undefined;
    }
  };

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

    const state = initializeCourseState(
      "joshcomeau",
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
    console.log(chalk.blue(`📝 Syncing ${lessonTasks.length} lessons...\n`));

    const extraction = await processLessons(
      session.context,
      session.page,
      lessonTasks,
      options,
      config,
      () => database,
      state.retryLessonIds
    );
    const currentDatabase = database;
    for (const extractionError of extraction.errors) {
      const lesson = lessonTasks[extractionError.index]?.lesson.name ?? "Unknown lesson";
      const message =
        extractionError.error instanceof Error
          ? extractionError.error.message
          : String(extractionError.error);
      const lessonTask = lessonTasks[extractionError.index];
      if (lessonTask && currentDatabase) {
        markLessonFailure(currentDatabase, lessonTask.stateId, extractionError.error, "SYNC_ERROR");
      }
      console.error(chalk.red(`   ${lesson}: ${message}`));
    }
    const videoTasks = extraction.results.flatMap((result) => result.videoTasks);
    const downloadSummary =
      options.skipVideos || videoTasks.length === 0
        ? { completed: 0, failures: [], outcomes: [] }
        : await downloadVideoTasks(videoTasks, {
            concurrency: config.concurrency,
            shouldContinue: shutdown.shouldContinue,
            heading: `Downloading ${videoTasks.length} Josh Comeau videos...`,
          });
    const videos = currentDatabase
      ? recordJoshVideoDownloads(currentDatabase, extraction.results, downloadSummary)
      : 0;

    if (extraction.errors.length > 0) {
      throw new Error(`${extraction.errors.length} Josh Comeau lesson(s) failed`);
    }

    const contentSaved = extraction.results.filter((result) => result.contentSaved).length;
    const cached = extraction.results.filter((result) => result.cached).length;
    const resources = extraction.results.reduce(
      (sum, result) => sum + result.resourcesDownloaded,
      0
    );
    console.log(chalk.green("\n✅ Josh Comeau sync complete!\n"));
    console.log(
      chalk.gray(`   Content: ${contentSaved} saved, ${resources} resources, ${cached} cached`)
    );
    if (!options.skipVideos) console.log(chalk.gray(`   Videos: ${videos} downloaded`));
    console.log(chalk.gray(`   Output: ${courseDir}\n`));
  } finally {
    closeDatabase();
    if (browser) await browser.close();
  }
}
