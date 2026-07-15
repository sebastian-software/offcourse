import chalk from "chalk";
import cliProgress from "cli-progress";
import ora from "ora";
import { basename } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { loadConfig } from "../../config/configManager.js";
import { downloadVideo, type VideoDownloadTask } from "../../downloader/index.js";
import { getAuthenticatedSession } from "../../shared/auth.js";
import { parallelProcess } from "../../shared/parallelWorker.js";
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
}

interface LessonTask {
  module: PiccalilliModule;
  lesson: PiccalilliLesson;
  moduleDir: string;
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
  limit?: number
): Promise<LessonTask[]> {
  const tasks: LessonTask[] = [];

  for (const module of structure.modules) {
    const moduleDir = await createModuleDirectory(courseDir, module.index, module.name);
    for (const lesson of module.lessons) {
      tasks.push({ module, lesson, moduleDir });
    }
  }

  return typeof limit === "number" ? tasks.slice(0, limit) : tasks;
}

async function processLessons(
  context: BrowserContext,
  mainPage: Page,
  tasks: LessonTask[],
  options: SyncPiccalilliOptions,
  config: { extractionConcurrency: number; videoQuality: string }
): Promise<{ results: LessonResult[]; errors: { index: number; error: unknown }[] }> {
  const browserCookies = await context.cookies();
  const cookies = browserCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
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
      const syncStatus = await isLessonSynced(moduleDir, lesson.index, lesson.name);
      const force = options.force ?? false;
      const needsContent = !options.skipContent && (force || !syncStatus.content);
      const needsVideo = !options.skipVideos && (force || !syncStatus.video);

      if (!needsContent && !needsVideo) {
        processed++;
        progressBar.update(processed, { status: lesson.name });
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
          lessonId: lesson.number,
          lessonName: lesson.name,
          videoUrl: content.video.hlsUrl,
          videoType: "hls",
          outputPath: getVideoPath(moduleDir, lesson.index, lesson.name),
          preferredQuality: options.quality ?? config.videoQuality,
          cookies,
          referer: content.video.referer,
        };
      }

      processed++;
      const shortName = lesson.name.length > 42 ? `${lesson.name.slice(0, 39)}...` : lesson.name;
      progressBar.update(processed, { status: shortName });

      return {
        cached: false,
        contentSaved: needsContent,
        resourcesDownloaded,
        videoTask,
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

async function downloadVideos(
  tasks: VideoDownloadTask[],
  concurrency: number
): Promise<{ completed: number; failures: { lesson: string; error: string }[] }> {
  if (tasks.length === 0) return { completed: 0, failures: [] };

  console.log(chalk.blue(`\n🎬 Downloading ${tasks.length} videos...\n`));
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

  const queue = [...tasks];
  const failures: { lesson: string; error: string }[] = [];
  let completed = 0;
  let processed = 0;

  const runWorker = async (): Promise<void> => {
    while (shutdown.shouldContinue() && queue.length > 0) {
      const task = queue.shift();
      if (!task) break;

      const result = await downloadVideo(task);
      if (result.success) {
        completed++;
      } else {
        failures.push({ lesson: task.lessonName, error: result.error ?? "Download failed" });
      }
      processed++;
      progressBar.update(processed, { status: task.lessonName });
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, async () => runWorker())
  );
  progressBar.stop();
  return { completed, failures };
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

    const courseDir = await createCourseDirectory(config.outputDir, structure.name);
    const lessonTasks = await buildLessonTasks(structure, courseDir, options.limit);
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
      config
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
      ? { completed: 0, failures: [] }
      : await downloadVideos(videoTasks, config.concurrency);

    for (const failure of downloads.failures) {
      console.error(chalk.red(`   ${failure.lesson}: ${failure.error}`));
    }
    for (const extractionError of extraction.errors) {
      const lesson = lessonTasks[extractionError.index]?.lesson.name ?? "Unknown lesson";
      const message =
        extractionError.error instanceof Error
          ? extractionError.error.message
          : String(extractionError.error);
      console.error(chalk.red(`   ${lesson}: ${message}`));
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
    if (browser) await browser.close();
  }
}
