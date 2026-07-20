import type { Browser, BrowserContext, Page } from "playwright";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  browserClose: vi.fn(),
  buildCourseStructure: vi.fn(),
  createCourseDirectory: vi.fn(),
  createModuleDirectory: vi.fn(),
  downloadResource: vi.fn(),
  downloadVideo: vi.fn(),
  extractLesson: vi.fn(),
  formatMarkdown: vi.fn(),
  getAuthenticatedSession: vi.fn(),
  getDownloadFilePath: vi.fn(),
  getMarkdownPath: vi.fn(),
  getVideoPath: vi.fn(),
  isCourseUrl: vi.fn(),
  normalizeCourseUrl: vi.fn(),
  parallelProcess: vi.fn(),
  pathExists: vi.fn(),
  progressStart: vi.fn(),
  progressStop: vi.fn(),
  progressUpdate: vi.fn(),
  registerBrowser: vi.fn(),
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
    videoQuality: "720p",
  }),
}));

vi.mock("../../downloader/index.js", () => ({ downloadVideo: mocks.downloadVideo }));
vi.mock("../../shared/auth.js", () => ({
  getAuthenticatedSession: mocks.getAuthenticatedSession,
}));
vi.mock("../../shared/fs.js", () => ({ pathExists: mocks.pathExists }));
vi.mock("../../shared/parallelWorker.js", () => ({ parallelProcess: mocks.parallelProcess }));
vi.mock("../../shared/shutdown.js", () => ({
  createShutdownManager: () => ({
    setup: mocks.setupShutdown,
    registerBrowser: mocks.registerBrowser,
    shouldContinue: mocks.shouldContinue,
  }),
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
  mocks.getDownloadFilePath.mockImplementation(
    (_moduleDir: string, _index: number, _name: string, filename: string) =>
      `/courses/css-for-js/01-rendering-logic/${filename}`
  );
  mocks.pathExists.mockResolvedValue(false);
  mocks.extractLesson.mockResolvedValue(lessonContent());
  mocks.rewriteLinks.mockImplementation((markdown: string) => markdown);
  mocks.formatMarkdown.mockReturnValue("# Flow Layout\n");
  mocks.downloadResource.mockResolvedValue({ success: true });
  mocks.downloadVideo.mockResolvedValue({ success: true });
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
    expect(mocks.downloadVideo).toHaveBeenCalledTimes(2);
    expect(mocks.downloadVideo).toHaveBeenLastCalledWith(
      expect.objectContaining({
        lessonName: "Flow Layout (video 2)",
        outputPath: "/courses/css-for-js/01-rendering-logic/video-02.mp4",
        preferredQuality: "1080p",
      })
    );
    expect(mocks.browserClose).toHaveBeenCalledOnce();
  });

  it("uses the cached fast path when content exists and videos are skipped", async () => {
    mocks.pathExists.mockResolvedValue(true);

    await syncJoshComeauCommand(courseUrl, { skipVideos: true });

    expect(mocks.extractLesson).not.toHaveBeenCalled();
    expect(mocks.saveMarkdown).not.toHaveBeenCalled();
    expect(mocks.downloadVideo).not.toHaveBeenCalled();
    expect(mocks.browserClose).toHaveBeenCalledOnce();
  });

  it("reports lesson failures and still closes the browser", async () => {
    mocks.downloadResource.mockResolvedValue({ success: false, error: "HTTP 403" });

    await expect(syncJoshComeauCommand(courseUrl, { skipVideos: true })).rejects.toThrow(
      "1 Josh Comeau lesson(s) failed"
    );

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("HTTP 403"));
    expect(mocks.browserClose).toHaveBeenCalledOnce();
  });
});
