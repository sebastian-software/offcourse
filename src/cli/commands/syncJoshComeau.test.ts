import type { Browser, BrowserContext, Page } from "playwright";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  browserClose: vi.fn(),
  buildCourseStructure: vi.fn(),
  createCourseDirectory: vi.fn(),
  createModuleDirectory: vi.fn(),
  downloadResource: vi.fn(),
  downloadVideoTasks: vi.fn(),
  extractLesson: vi.fn(),
  formatMarkdown: vi.fn(),
  getAuthenticatedSession: vi.fn(),
  getDownloadFilePath: vi.fn(),
  getMarkdownPath: vi.fn(),
  getVideoPath: vi.fn(),
  initializeCourseState: vi.fn(),
  isCourseUrl: vi.fn(),
  isLessonSynced: vi.fn(),
  markLessonFailure: vi.fn(),
  markLessonScanReady: vi.fn(),
  normalizeCourseUrl: vi.fn(),
  parallelProcess: vi.fn(),
  pathExists: vi.fn(),
  progressStart: vi.fn(),
  progressStop: vi.fn(),
  progressUpdate: vi.fn(),
  registerBrowser: vi.fn(),
  registerCleanup: vi.fn(),
  rewriteLinks: vi.fn(),
  saveMarkdown: vi.fn(),
  setupShutdown: vi.fn(),
  shouldContinue: vi.fn(),
  spinnerStart: vi.fn(),
  spinnerSucceed: vi.fn(),
}));

vi.mock("ora", () => ({
  default: vi.fn(() => ({
    start: mocks.spinnerStart,
    succeed: mocks.spinnerSucceed,
  })),
}));

vi.mock("cli-progress", () => ({
  default: {
    Presets: { shades_grey: {} },
    SingleBar: class {
      start(...args: unknown[]): void {
        mocks.progressStart(...args);
      }

      update(...args: unknown[]): void {
        mocks.progressUpdate(...args);
      }

      stop(...args: unknown[]): void {
        mocks.progressStop(...args);
      }
    },
  },
}));

vi.mock("../../config/configManager.js", () => ({
  loadConfig: () => ({
    outputDir: "/courses",
    headless: true,
    extractionConcurrency: 4,
    concurrency: 2,
    videoQuality: "720p",
  }),
}));

vi.mock("../../downloader/index.js", () => ({}));
vi.mock("../syncPipeline.js", async () => ({
  ...(await vi.importActual<typeof import("../syncPipeline.js")>("../syncPipeline.js")),
  downloadVideoTasks: mocks.downloadVideoTasks,
}));
vi.mock("../../shared/auth.js", () => ({
  getAuthenticatedSession: mocks.getAuthenticatedSession,
}));
vi.mock("../../shared/fs.js", () => ({ pathExists: mocks.pathExists }));
vi.mock("../../shared/parallelWorker.js", () => ({ parallelProcess: mocks.parallelProcess }));
vi.mock("../../shared/shutdown.js", () => ({
  createShutdownManager: () => ({
    setup: mocks.setupShutdown,
    registerBrowser: mocks.registerBrowser,
    registerCleanup: mocks.registerCleanup,
    shouldContinue: mocks.shouldContinue,
  }),
}));
vi.mock("../../state/index.js", () => ({
  initializeCourseState: mocks.initializeCourseState,
  LessonStatus: { PENDING: "pending", DOWNLOADED: "downloaded" },
  markLessonFailure: mocks.markLessonFailure,
  markLessonScanReady: mocks.markLessonScanReady,
  recordVideoDownloadResult: vi.fn(),
}));
vi.mock("../../scraper/joshcomeau/index.js", () => ({
  buildJoshComeauCourseStructure: mocks.buildCourseStructure,
  createJoshComeauSessionVerifier: () => vi.fn(),
  downloadJoshComeauResource: mocks.downloadResource,
  extractJoshComeauLesson: mocks.extractLesson,
  formatJoshComeauMarkdown: mocks.formatMarkdown,
  isJoshComeauCourseUrl: mocks.isCourseUrl,
  isJoshComeauLoginPage: vi.fn(),
  JOSH_COMEAU_DOMAIN: "courses.joshwcomeau.com",
  JOSH_COMEAU_LOGIN_URL: "https://courses.joshwcomeau.com/",
  normalizeJoshComeauCourseUrl: mocks.normalizeCourseUrl,
  rewriteJoshComeauResourceLinks: mocks.rewriteLinks,
}));
vi.mock("../../storage/fileSystem.js", () => ({
  createCourseDirectory: mocks.createCourseDirectory,
  createModuleDirectory: mocks.createModuleDirectory,
  getDownloadFilePath: mocks.getDownloadFilePath,
  getMarkdownPath: mocks.getMarkdownPath,
  getVideoPath: mocks.getVideoPath,
  isLessonSynced: mocks.isLessonSynced,
  saveMarkdown: mocks.saveMarkdown,
}));

import { syncJoshComeauCommand } from "./syncJoshComeau.js";

interface TestTask {
  lesson: { name: string };
}

type TestWorker = (page: Page, task: TestTask, index: number) => Promise<unknown>;

interface TestWorkerOptions {
  onError: (error: unknown, index: number) => void;
}

const courseUrl = "https://courses.joshwcomeau.com/css-for-js";
const browser = { close: mocks.browserClose } as unknown as Browser;
const context = {} as BrowserContext;
const page = {} as Page;

function courseStructure() {
  return {
    name: "CSS for JavaScript Developers",
    slug: "css-for-js" as const,
    url: courseUrl,
    modules: [
      {
        name: "Rendering Logic",
        slug: "rendering-logic",
        number: 1,
        index: 0,
        lessons: [
          {
            name: "Flow Layout",
            slug: "flow-layout",
            url: `${courseUrl}/rendering-logic/flow-layout`,
            number: 1,
            index: 0,
          },
        ],
      },
    ],
  };
}

function lessonContent() {
  return {
    title: "Flow Layout",
    htmlContent: "<p>Content</p>",
    markdownContent: "Content",
    resources: [{ url: "https://cdn.example/flow.zip", filename: "flow.zip" }],
    videos: [
      {
        embedUrl: "https://player.vimeo.com/video/1",
        hlsUrl: "https://cdn.example/1.m3u8",
        referer: `${courseUrl}/rendering-logic/flow-layout`,
      },
      {
        embedUrl: "https://player.vimeo.com/video/2",
        hlsUrl: "https://cdn.example/2.m3u8",
        referer: `${courseUrl}/rendering-logic/flow-layout`,
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.spinnerStart.mockReturnValue({ succeed: mocks.spinnerSucceed });
  mocks.shouldContinue.mockReturnValue(true);
  mocks.isCourseUrl.mockReturnValue(true);
  mocks.normalizeCourseUrl.mockReturnValue(courseUrl);
  mocks.getAuthenticatedSession.mockResolvedValue({
    browser,
    session: { context, page },
    usedCachedSession: true,
  });
  mocks.buildCourseStructure.mockResolvedValue(courseStructure());
  mocks.createCourseDirectory.mockResolvedValue("/courses/css-for-js");
  mocks.createModuleDirectory.mockResolvedValue("/courses/css-for-js/01-rendering-logic");
  mocks.getMarkdownPath.mockReturnValue("/courses/css-for-js/01-rendering-logic/01-flow.md");
  mocks.getVideoPath.mockReturnValue("/courses/css-for-js/01-rendering-logic/01-flow.mp4");
  mocks.isLessonSynced.mockResolvedValue({ content: false, video: false });
  mocks.getDownloadFilePath.mockImplementation(
    (_moduleDir: string, _index: number, _name: string, filename: string) =>
      `/courses/css-for-js/01-rendering-logic/${filename}`
  );
  mocks.pathExists.mockResolvedValue(false);
  const stateLesson = {
    id: 1,
    status: "pending",
    retryCount: 0,
  };
  mocks.initializeCourseState.mockReturnValue({
    key: "joshcomeau-css-for-js",
    database: {
      close: vi.fn(),
      getLessonByUrl: vi.fn(() => stateLesson),
      markLessonDownloaded: vi.fn(),
      markLessonSkipped: vi.fn(),
    },
    lessonsByUrl: new Map([[`${courseUrl}/rendering-logic/flow-layout`, stateLesson]]),
    retryLessonIds: new Set(),
  });
  mocks.extractLesson.mockResolvedValue(lessonContent());
  mocks.rewriteLinks.mockImplementation((markdown: string) => markdown);
  mocks.formatMarkdown.mockReturnValue("# Flow Layout\n");
  mocks.downloadResource.mockResolvedValue({ success: true });
  mocks.downloadVideoTasks.mockImplementation(async (tasks: unknown[]) => ({
    completed: tasks.length,
    failures: [],
    outcomes: tasks.map((task) => ({ task, result: { success: true } })),
  }));
  mocks.parallelProcess.mockImplementation(
    async (
      _context: BrowserContext,
      _mainPage: Page,
      tasks: TestTask[],
      worker: TestWorker,
      options: TestWorkerOptions
    ) => {
      const results: unknown[] = [];
      const errors: { index: number; error: unknown }[] = [];
      for (const [index, task] of tasks.entries()) {
        try {
          results.push(await worker(page, task, index));
        } catch (error) {
          options.onError(error, index);
          errors.push({ index, error });
        }
      }
      return { results, errors };
    }
  );
});

describe("syncJoshComeauCommand", () => {
  it("rejects unsupported course URLs before opening a browser", async () => {
    mocks.isCourseUrl.mockReturnValue(false);

    await expect(syncJoshComeauCommand("https://example.com/course", {})).rejects.toThrow(
      "Expected a supported Josh Comeau course or lesson URL"
    );

    expect(mocks.getAuthenticatedSession).not.toHaveBeenCalled();
  });

  it("prints the authenticated course structure in dry-run mode", async () => {
    await syncJoshComeauCommand(courseUrl, { dryRun: true, courseName: "CSS Course" });

    expect(mocks.getAuthenticatedSession).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: "courses.joshwcomeau.com",
        verifySession: expect.any(Function),
      }),
      { headless: true, useStandardBrowserUserAgent: true }
    );
    expect(mocks.buildCourseStructure).toHaveBeenCalledWith(page, courseUrl);
    expect(mocks.createCourseDirectory).not.toHaveBeenCalled();
    expect(mocks.browserClose).toHaveBeenCalledOnce();
  });

  it("downloads lesson content, resources, and multiple videos", async () => {
    await syncJoshComeauCommand(courseUrl, { limit: 1, quality: "1080p" });

    expect(mocks.saveMarkdown).toHaveBeenCalledWith(
      "/courses/css-for-js/01-rendering-logic",
      "01-flow-layout.md",
      "# Flow Layout\n"
    );
    expect(mocks.downloadResource).toHaveBeenCalledOnce();
    expect(mocks.downloadVideoTasks).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          lessonName: "Flow Layout (video 2)",
          outputPath: "/courses/css-for-js/01-rendering-logic/video-02.mp4",
          preferredQuality: "1080p",
        }),
      ]),
      expect.objectContaining({ concurrency: 2 })
    );
    expect(mocks.registerCleanup).toHaveBeenCalledOnce();
    expect(mocks.browserClose).toHaveBeenCalledOnce();
  });

  it("uses the cached fast path when content exists and videos are skipped", async () => {
    mocks.isLessonSynced.mockResolvedValue({ content: true, video: true });

    await syncJoshComeauCommand(courseUrl, { skipVideos: true });

    expect(mocks.extractLesson).not.toHaveBeenCalled();
    expect(mocks.saveMarkdown).not.toHaveBeenCalled();
    expect(mocks.downloadVideoTasks).not.toHaveBeenCalled();
    expect(mocks.browserClose).toHaveBeenCalledOnce();
  });

  it("re-downloads existing video files when retrying a failed lesson", async () => {
    const stateLesson = { id: 1, status: "pending", retryCount: 1 };
    mocks.initializeCourseState.mockReturnValue({
      key: "joshcomeau-css-for-js",
      database: {
        close: vi.fn(),
        getLessonByUrl: vi.fn(() => stateLesson),
        markLessonDownloaded: vi.fn(),
        markLessonSkipped: vi.fn(),
      },
      lessonsByUrl: new Map([[`${courseUrl}/rendering-logic/flow-layout`, stateLesson]]),
      retryLessonIds: new Set([1]),
    });
    mocks.isLessonSynced.mockResolvedValue({ content: true, video: true });
    mocks.pathExists.mockResolvedValue(true);

    await syncJoshComeauCommand(courseUrl, { retryFailed: true });

    expect(mocks.downloadVideoTasks).toHaveBeenCalledOnce();
  });

  it("records an interrupted shared video queue as a lesson failure", async () => {
    mocks.downloadVideoTasks.mockResolvedValue({ completed: 0, failures: [], outcomes: [] });

    await syncJoshComeauCommand(courseUrl, {});

    expect(mocks.markLessonFailure).toHaveBeenCalledWith(
      expect.any(Object),
      1,
      expect.objectContaining({ message: expect.stringContaining("interrupted") }),
      "DOWNLOAD_INTERRUPTED"
    );
  });

  it("reconciles queued videos when shutdown is requested", async () => {
    let continueProcessing = true;
    mocks.shouldContinue.mockImplementation(() => continueProcessing);
    mocks.markLessonScanReady.mockImplementation(() => {
      continueProcessing = false;
    });
    mocks.downloadVideoTasks.mockResolvedValue({ completed: 0, failures: [], outcomes: [] });

    await syncJoshComeauCommand(courseUrl, {});

    expect(mocks.downloadVideoTasks).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ lessonId: 1 })]),
      expect.objectContaining({ shouldContinue: expect.any(Function) })
    );
    expect(mocks.markLessonFailure).toHaveBeenCalledWith(
      expect.any(Object),
      1,
      expect.objectContaining({ message: expect.stringContaining("interrupted") }),
      "DOWNLOAD_INTERRUPTED"
    );
  });

  it("reports lesson failures and still closes the browser", async () => {
    mocks.downloadResource.mockResolvedValue({ success: false, error: "HTTP 403" });

    await expect(syncJoshComeauCommand(courseUrl, { skipVideos: true })).rejects.toThrow(
      "1 Josh Comeau lesson(s) failed"
    );

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("HTTP 403"));
    expect(mocks.browserClose).toHaveBeenCalledOnce();
  });

  it("downloads successful sibling lessons before reporting extraction failures", async () => {
    const structure = courseStructure();
    const secondLesson = {
      name: "Responsive Design",
      slug: "responsive-design",
      url: `${courseUrl}/rendering-logic/responsive-design`,
      number: 2,
      index: 1,
    };
    const firstModule = structure.modules[0];
    if (!firstModule) throw new Error("Expected the test course to have a module");
    firstModule.lessons.push(secondLesson);
    mocks.buildCourseStructure.mockResolvedValue(structure);

    const firstStateLesson = { id: 1, status: "pending", retryCount: 0 };
    const secondStateLesson = { id: 2, status: "pending", retryCount: 0 };
    const database = {
      close: vi.fn(),
      getLessonByUrl: vi.fn((url: string) =>
        url.endsWith("responsive-design") ? secondStateLesson : firstStateLesson
      ),
      markLessonDownloaded: vi.fn(),
      markLessonSkipped: vi.fn(),
    };
    mocks.initializeCourseState.mockReturnValue({
      key: "joshcomeau-css-for-js",
      database,
      lessonsByUrl: new Map([
        [`${courseUrl}/rendering-logic/flow-layout`, firstStateLesson],
        [secondLesson.url, secondStateLesson],
      ]),
      retryLessonIds: new Set(),
    });
    mocks.extractLesson.mockImplementation(async (_page: Page, url: string) => {
      if (url.endsWith("flow-layout")) throw new Error("Extraction failed");
      return lessonContent();
    });

    await expect(syncJoshComeauCommand(courseUrl, {})).rejects.toThrow(
      "1 Josh Comeau lesson(s) failed"
    );

    expect(mocks.downloadVideoTasks).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ lessonId: 2 })]),
      expect.objectContaining({ concurrency: 2 })
    );
    expect(mocks.markLessonFailure).toHaveBeenCalledWith(
      database,
      1,
      expect.any(Error),
      "SYNC_ERROR"
    );
  });
});
