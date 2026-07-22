import type { Browser, BrowserContext, Page } from "playwright";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface ParallelStageInput {
  tasks: unknown[];
  processTask: (page: Page, task: unknown, index: number) => Promise<unknown>;
}

type InitializeCourseStateArgs = Parameters<
  (typeof import("../../state/index.js"))["initializeCourseState"]
>;
type InitializedCourseState = ReturnType<
  (typeof import("../../state/index.js"))["initializeCourseState"]
>;

const mocks = vi.hoisted(() => ({
  browserClose: vi.fn(),
  buildCourseStructure: vi.fn(),
  createCourseDirectory: vi.fn(),
  createModuleDirectory: vi.fn(),
  downloadResource: vi.fn(),
  downloadVideoTasks: vi.fn(),
  extractLesson: vi.fn(),
  formatMarkdown: vi.fn(),
  getDownloadFilePath: vi.fn(),
  getVideoPath: vi.fn(),
  initializeCourseState: vi.fn(),
  isCourseUrl: vi.fn(),
  isLessonSynced: vi.fn(),
  launch: vi.fn(),
  markLessonFailure: vi.fn(),
  markLessonScanReady: vi.fn(),
  normalizeCourseUrl: vi.fn(),
  pathExists: vi.fn(),
  registerBrowser: vi.fn(),
  registerCleanup: vi.fn(),
  recordVideoDownloadResult: vi.fn(),
  rewriteLinks: vi.fn(),
  runParallelSyncStage: vi.fn(),
  saveMarkdown: vi.fn(),
  setupShutdown: vi.fn(),
  shouldContinue: vi.fn(),
  spinnerFail: vi.fn(),
  spinnerStart: vi.fn(),
  spinnerSucceed: vi.fn(),
}));

vi.mock("ora", () => ({
  default: vi.fn(() => ({
    fail: mocks.spinnerFail,
    start: mocks.spinnerStart,
    succeed: mocks.spinnerSucceed,
  })),
}));

vi.mock("playwright", () => ({
  chromium: { launch: mocks.launch },
}));

vi.mock("../../config/configManager.js", () => ({
  loadConfig: () => ({
    concurrency: 2,
    extractionConcurrency: 2,
    headless: true,
    outputDir: "/courses",
    videoQuality: "720p",
  }),
}));

vi.mock("../../shared/auth.js", () => ({
  getAuthenticatedSession: vi.fn(),
}));
vi.mock("../../shared/fs.js", () => ({ pathExists: mocks.pathExists }));
vi.mock("../../shared/shutdown.js", () => ({
  createShutdownManager: () => ({
    registerBrowser: mocks.registerBrowser,
    registerCleanup: mocks.registerCleanup,
    setup: mocks.setupShutdown,
    shouldContinue: mocks.shouldContinue,
  }),
}));
vi.mock("../../state/index.js", () => ({
  initializeCourseState: mocks.initializeCourseState,
  LessonStatus: { DOWNLOADED: "downloaded" },
  markLessonFailure: mocks.markLessonFailure,
  markLessonScanReady: mocks.markLessonScanReady,
  recordVideoDownloadResult: mocks.recordVideoDownloadResult,
}));
vi.mock("../../scraper/piccalilli/index.js", () => ({
  buildPiccalilliCourseStructure: mocks.buildCourseStructure,
  createPiccalilliSessionVerifier: vi.fn(),
  downloadPiccalilliResource: mocks.downloadResource,
  extractPiccalilliLesson: mocks.extractLesson,
  formatPiccalilliMarkdown: mocks.formatMarkdown,
  isPiccalilliCourseUrl: mocks.isCourseUrl,
  isPiccalilliLoginPage: vi.fn(),
  normalizePiccalilliCourseUrl: mocks.normalizeCourseUrl,
  PICCALILLI_DOMAIN: "piccalil.li",
  PICCALILLI_LOGIN_URL: "https://piccalil.li/login",
  rewritePiccalilliResourceLinks: mocks.rewriteLinks,
}));
vi.mock("../../storage/fileSystem.js", () => ({
  createCourseDirectory: mocks.createCourseDirectory,
  createModuleDirectory: mocks.createModuleDirectory,
  getDownloadFilePath: mocks.getDownloadFilePath,
  getVideoPath: mocks.getVideoPath,
  isLessonSynced: mocks.isLessonSynced,
  saveMarkdown: mocks.saveMarkdown,
}));
vi.mock("../syncPipeline.js", () => ({
  downloadVideoTasks: mocks.downloadVideoTasks,
  runParallelSyncStage: mocks.runParallelSyncStage,
}));

import { syncPiccalilliCommand } from "./syncPiccalilli.js";

const courseUrl = "https://piccalil.li/course/lessons";
const lessonUrl = `${courseUrl}/1`;
const stateLesson = { id: 1, retryCount: 0, status: "pending" };
const newPage = vi.fn();
const context = {
  cookies: vi.fn().mockResolvedValue([]),
  newPage,
} as unknown as BrowserContext;
const browser = {
  close: mocks.browserClose,
  newContext: vi.fn().mockResolvedValue(context),
} as unknown as Browser;
const page = { url: vi.fn().mockReturnValue(courseUrl) } as unknown as Page;

function courseStructure() {
  return {
    name: "Modern CSS",
    slug: "course",
    url: courseUrl,
    modules: [
      {
        name: "Foundations",
        slug: "foundations",
        number: 1,
        index: 0,
        lessons: [
          {
            name: "Selectors",
            slug: "1",
            url: lessonUrl,
            number: 1,
            index: 0,
            isFree: true,
            duration: "12:00",
          },
        ],
      },
    ],
  };
}

function lessonContent() {
  return {
    title: "Selectors",
    htmlContent: "<p>Content</p>",
    markdownContent: "Content",
    resources: [{ url: "https://cdn.example/cheatsheet.pdf", filename: "cheatsheet.pdf" }],
    video: {
      embedUrl: "https://iframe.mediadelivery.net/embed/123",
      hlsUrl: "https://cdn.example/playlist.m3u8",
      referer: lessonUrl,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.browserClose.mockResolvedValue(undefined);
  mocks.shouldContinue.mockReturnValue(true);
  mocks.spinnerStart.mockReturnValue({
    fail: mocks.spinnerFail,
    succeed: mocks.spinnerSucceed,
  });
  mocks.isCourseUrl.mockReturnValue(true);
  mocks.normalizeCourseUrl.mockReturnValue(courseUrl);
  mocks.launch.mockResolvedValue(browser);
  newPage.mockResolvedValue(page);
  mocks.buildCourseStructure.mockResolvedValue(courseStructure());
  mocks.createCourseDirectory.mockResolvedValue("/courses/Modern CSS");
  mocks.createModuleDirectory.mockResolvedValue("/courses/Modern CSS/01-foundations");
  mocks.getDownloadFilePath.mockImplementation(
    (_moduleDir: string, _index: number, _name: string, filename: string) =>
      `/courses/Modern CSS/01-foundations/${filename}`
  );
  mocks.getVideoPath.mockReturnValue("/courses/Modern CSS/01-foundations/01-selectors.mp4");
  mocks.isLessonSynced.mockResolvedValue({ content: false, video: false });
  mocks.pathExists.mockResolvedValue(false);
  mocks.initializeCourseState.mockReturnValue({
    key: "piccalilli-course",
    database: {
      close: vi.fn(),
      getLessonByUrl: vi.fn(() => stateLesson),
      markLessonDownloaded: vi.fn(),
      markLessonSkipped: vi.fn(),
    },
    lessonsByUrl: new Map([[lessonUrl, stateLesson]]),
    retryLessonIds: new Set(),
  });
  mocks.extractLesson.mockResolvedValue(lessonContent());
  mocks.rewriteLinks.mockImplementation((markdown: string) => markdown);
  mocks.formatMarkdown.mockReturnValue("# Selectors\n");
  mocks.downloadResource.mockResolvedValue({ success: true });
  mocks.downloadVideoTasks.mockResolvedValue({ completed: 1, failures: [], outcomes: [] });
  mocks.runParallelSyncStage.mockImplementation(async (options: ParallelStageInput) => {
    const results: unknown[] = [];
    const errors: { index: number; error: unknown }[] = [];
    for (const [index, task] of options.tasks.entries()) {
      try {
        results.push(await options.processTask(page, task, index));
      } catch (error) {
        errors.push({ index, error });
      }
    }
    return { results, errors };
  });
});

describe("syncPiccalilliCommand", () => {
  it("rejects unsupported URLs before launching a browser", async () => {
    mocks.isCourseUrl.mockReturnValue(false);

    await expect(syncPiccalilliCommand("https://example.com/course", {})).rejects.toThrow(
      "Expected a Piccalilli course overview or lesson URL"
    );

    expect(mocks.launch).not.toHaveBeenCalled();
  });

  it("prints a public course structure in dry-run mode", async () => {
    await syncPiccalilliCommand(courseUrl, { dryRun: true, courseName: "CSS Course" });

    expect(mocks.launch).toHaveBeenCalledWith({ headless: true });
    expect(mocks.buildCourseStructure).toHaveBeenCalledWith(page, courseUrl);
    expect(mocks.initializeCourseState).not.toHaveBeenCalled();
    expect(mocks.browserClose).toHaveBeenCalledOnce();
  });

  it("syncs public lesson content, resources, and videos through the shared pipeline", async () => {
    await syncPiccalilliCommand(courseUrl, { quality: "1080p" });

    expect(mocks.createCourseDirectory).toHaveBeenCalledWith("/courses", "Modern CSS");
    expect(mocks.saveMarkdown).toHaveBeenCalledWith(
      "/courses/Modern CSS/01-foundations",
      "01-selectors.md",
      "# Selectors\n"
    );
    expect(mocks.downloadResource).toHaveBeenCalledWith(
      page,
      "https://cdn.example/cheatsheet.pdf",
      "/courses/Modern CSS/01-foundations/cheatsheet.pdf",
      lessonUrl
    );
    expect(mocks.markLessonScanReady).toHaveBeenCalledWith(
      expect.any(Object),
      1,
      expect.objectContaining({
        lessonName: "Selectors",
        preferredQuality: "1080p",
        videoType: "hls",
      })
    );
    expect(mocks.downloadVideoTasks).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          lessonId: 1,
          lessonName: "Selectors",
          preferredQuality: "1080p",
          videoUrl: "https://cdn.example/playlist.m3u8",
        }),
      ],
      expect.objectContaining({ concurrency: 2 })
    );
    expect(mocks.browserClose).toHaveBeenCalledOnce();
  });

  it("can run the command against a real in-memory CourseDatabase", async () => {
    const actualState =
      await vi.importActual<typeof import("../../state/index.js")>("../../state/index.js");
    let initialized: InitializedCourseState | undefined;
    let closeDatabase: (() => void) | undefined;
    mocks.initializeCourseState.mockImplementationOnce(
      (
        platform: InitializeCourseStateArgs[0],
        sourceUrl: InitializeCourseStateArgs[1],
        structure: InitializeCourseStateArgs[2],
        options: InitializeCourseStateArgs[3]
      ) => {
        initialized = actualState.initializeCourseState(platform, sourceUrl, structure, {
          ...options,
          databasePath: ":memory:",
        });
        closeDatabase = initialized.database.close.bind(initialized.database);
        vi.spyOn(initialized.database, "close").mockImplementation(() => undefined);
        return initialized;
      }
    );
    mocks.markLessonScanReady.mockImplementation(actualState.markLessonScanReady);

    try {
      await syncPiccalilliCommand(courseUrl, {});

      expect(initialized?.database.getLessonByUrl(lessonUrl)).toMatchObject({
        status: "validated",
        videoUrl: "https://cdn.example/playlist.m3u8",
      });
    } finally {
      closeDatabase?.();
    }
  });
});
