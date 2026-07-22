import type { Browser, BrowserContext, Page } from "playwright";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  browserClose: vi.fn(),
  buildCourseStructure: vi.fn(),
  createCourseDirectory: vi.fn(),
  createModuleDirectory: vi.fn(),
  downloadVideoTasks: vi.fn(),
  extractPostContent: vi.fn(),
  getAuthenticatedSession: vi.fn(),
  getPostUrl: vi.fn(),
  initializeCourseState: vi.fn(),
  isLessonSynced: vi.fn(),
  markLessonFailure: vi.fn(),
  markLessonScanReady: vi.fn(),
  registerCleanup: vi.fn(),
  recordVideoDownloadResult: vi.fn(),
  runParallelSyncStage: vi.fn(),
  saveMarkdown: vi.fn(),
}));

vi.mock("ora", () => ({
  default: vi.fn(() => ({
    start: () => ({ succeed: vi.fn(), fail: vi.fn() }),
  })),
}));
vi.mock("../../config/configManager.js", () => ({
  loadConfig: () => ({
    outputDir: "/courses",
    headless: true,
    extractionConcurrency: 2,
    concurrency: 2,
  }),
}));
vi.mock("../../shared/auth.js", () => ({
  getAuthenticatedSession: mocks.getAuthenticatedSession,
  hasValidFirebaseToken: vi.fn(),
  isHighLevelLoginPage: vi.fn(),
}));
vi.mock("../../shared/shutdown.js", () => ({
  createShutdownManager: () => ({
    setup: vi.fn(),
    registerBrowser: vi.fn(),
    registerCleanup: mocks.registerCleanup,
    shouldContinue: () => true,
    isShuttingDown: () => false,
  }),
}));
vi.mock("../../scraper/highlevel/index.js", () => ({
  buildHighLevelCourseStructure: mocks.buildCourseStructure,
  createFolderName: (_index: number, name: string) => `01-${name.toLowerCase()}`,
  extractHighLevelPostContent: mocks.extractPostContent,
  getHighLevelPostUrl: mocks.getPostUrl,
}));
vi.mock("../../scraper/highlevel/navigator.js", () => ({
  slugify: (name: string) => name.toLowerCase().replaceAll(" ", "-"),
}));
vi.mock("../../storage/fileSystem.js", () => ({
  createCourseDirectory: mocks.createCourseDirectory,
  createModuleDirectory: mocks.createModuleDirectory,
  downloadFile: vi.fn(),
  getDownloadFilePath: vi.fn(() => "/courses/course/01-module/resource.pdf"),
  getVideoPath: vi.fn(() => "/courses/course/01-module/01-lesson.mp4"),
  isLessonSynced: mocks.isLessonSynced,
  saveMarkdown: mocks.saveMarkdown,
}));
vi.mock("../syncPipeline.js", () => ({
  createSyncProgressBar: vi.fn(),
  downloadVideoTasks: mocks.downloadVideoTasks,
  formatHtmlLessonMarkdown: vi.fn(() => "# Lesson\n"),
  runParallelSyncStage: mocks.runParallelSyncStage,
}));
vi.mock("../../state/index.js", () => ({
  initializeCourseState: mocks.initializeCourseState,
  LessonStatus: { PENDING: "pending", DOWNLOADED: "downloaded" },
  markLessonFailure: mocks.markLessonFailure,
  markLessonScanReady: mocks.markLessonScanReady,
  recordVideoDownloadResult: mocks.recordVideoDownloadResult,
}));

import { syncHighLevelCommand } from "./syncHighLevel.js";

const browser = { close: mocks.browserClose } as unknown as Browser;
const context = {} as BrowserContext;
const page = {} as Page;
const courseUrl = "https://courses.example.com/courses/products/course-id";
const lessonUrl = `${courseUrl}/categories/module-id/posts/lesson-id`;

interface ParallelStageOptions {
  tasks: unknown[];
  processTask: (page: Page, task: unknown, index: number) => Promise<unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  mocks.getAuthenticatedSession.mockResolvedValue({
    browser,
    session: { context, page },
    usedCachedSession: true,
  });
  mocks.buildCourseStructure.mockResolvedValue({
    course: {
      id: "course-id",
      title: "Course",
      description: "",
      slug: "course",
      thumbnailUrl: null,
      instructor: null,
      totalLessons: 1,
      progress: 0,
    },
    categories: [
      {
        id: "module-id",
        title: "Module",
        description: null,
        position: 0,
        postCount: 1,
        isLocked: false,
        posts: [
          {
            id: "lesson-id",
            title: "Lesson",
            position: 0,
            categoryId: "module-id",
            isLocked: false,
            isCompleted: false,
          },
        ],
      },
    ],
    locationId: "location-id",
    domain: "courses.example.com",
  });
  mocks.getPostUrl.mockReturnValue(lessonUrl);
  mocks.createCourseDirectory.mockResolvedValue("/courses/course");
  mocks.createModuleDirectory.mockResolvedValue("/courses/course/01-module");
  mocks.isLessonSynced.mockResolvedValue({ content: false, video: false });
  mocks.extractPostContent.mockResolvedValue({
    title: "Lesson",
    description: null,
    htmlContent: "<p>Content</p>",
    attachments: [],
    video: { url: "https://cdn.example.com/video.m3u8", type: "hls" },
  });
  const stateLesson = { id: 7, status: "pending", retryCount: 0 };
  const database = {
    close: vi.fn(),
    getLessonByUrl: vi.fn(() => stateLesson),
    markLessonDownloaded: vi.fn(),
    markLessonSkipped: vi.fn(),
  };
  mocks.initializeCourseState.mockReturnValue({
    key: "highlevel-courses-example-com-course-id",
    database,
    lessonsByUrl: new Map([[lessonUrl, stateLesson]]),
    retryLessonIds: new Set(),
  });
  mocks.runParallelSyncStage.mockImplementation(
    async ({ tasks, processTask }: ParallelStageOptions) => {
      const results = [];
      for (const [index, task] of tasks.entries()) {
        results.push(await processTask(page, task, index));
      }
      return { results, errors: [] };
    }
  );
  mocks.downloadVideoTasks.mockImplementation(async (tasks: unknown[]) => ({
    completed: tasks.length,
    failures: [],
    outcomes: tasks.map((task) => ({ task, result: { success: true } })),
  }));
});

describe("syncHighLevelCommand state tracking", () => {
  it("persists structure, tracks scan readiness, and records download outcomes", async () => {
    await syncHighLevelCommand(courseUrl, {});

    expect(mocks.initializeCourseState).toHaveBeenCalledWith(
      "highlevel",
      courseUrl,
      expect.objectContaining({
        name: "Course",
        modules: [
          expect.objectContaining({
            slug: "module-id",
            lessons: [expect.objectContaining({ slug: "lesson-id", url: lessonUrl })],
          }),
        ],
      }),
      {}
    );
    expect(mocks.markLessonScanReady).toHaveBeenCalledWith(
      expect.any(Object),
      7,
      expect.objectContaining({ lessonId: 7 })
    );
    expect(mocks.recordVideoDownloadResult).toHaveBeenCalledOnce();
    expect(mocks.registerCleanup).toHaveBeenCalledOnce();
    expect(mocks.browserClose).toHaveBeenCalledOnce();
  });
});
