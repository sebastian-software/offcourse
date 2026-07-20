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
  getLessonUrl: vi.fn(),
  initializeCourseState: vi.fn(),
  isLessonSynced: vi.fn(),
  markLessonFailure: vi.fn(),
  markLessonScanReady: vi.fn(),
  recordVideoDownloadResult: vi.fn(),
  runParallelSyncStage: vi.fn(),
  saveMarkdown: vi.fn(),
}));

vi.mock("ora", () => ({
  default: vi.fn(() => ({
    start: () => ({ succeed: vi.fn(), fail: vi.fn(), stop: vi.fn(), text: "" }),
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
}));
vi.mock("../../shared/shutdown.js", () => ({
  createShutdownManager: () => ({
    setup: vi.fn(),
    registerBrowser: vi.fn(),
    shouldContinue: () => true,
    isShuttingDown: () => false,
  }),
}));
vi.mock("../../scraper/learningsuite/index.js", () => ({
  buildLearningSuiteCourseStructure: mocks.buildCourseStructure,
  createFolderName: (_index: number, name: string) => `01-${name.toLowerCase()}`,
  createLearningSuiteSessionVerifier: () => vi.fn(),
  extractLearningSuitePostContent: mocks.extractPostContent,
  getAuthToken: vi.fn(async () => "token"),
  getLearningSuiteDomain: () => "academy.example.com",
  getLearningSuiteLessonUrl: mocks.getLessonUrl,
  isLearningSuiteLoginPage: vi.fn(),
  isLearningSuitePortal: vi.fn(),
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

import { syncLearningSuiteCommand } from "./syncLearningSuite.js";

const browser = { close: mocks.browserClose } as unknown as Browser;
const context = { cookies: vi.fn(async () => []) } as unknown as BrowserContext;
const page = { context: () => context } as unknown as Page;
const courseUrl = "https://academy.example.com/student/course/course/course-id";
const lessonUrl = `${courseUrl}/lesson-id`;

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
      description: null,
      thumbnailUrl: null,
      moduleCount: 1,
      lessonCount: 1,
    },
    modules: [
      {
        id: "module-id",
        title: "Module",
        description: null,
        position: 0,
        isLocked: false,
        lessons: [
          {
            id: "lesson-id",
            title: "Lesson",
            position: 0,
            moduleId: "module-id",
            isLocked: false,
            isCompleted: false,
          },
        ],
      },
    ],
    tenantId: "tenant-id",
    domain: "academy.example.com",
    courseSlug: "course",
  });
  mocks.getLessonUrl.mockReturnValue(lessonUrl);
  mocks.createCourseDirectory.mockResolvedValue("/courses/course");
  mocks.createModuleDirectory.mockResolvedValue("/courses/course/01-module");
  mocks.isLessonSynced.mockResolvedValue({ content: false, video: false });
  mocks.extractPostContent.mockResolvedValue({
    title: "Lesson",
    description: null,
    htmlContent: "<p>Content</p>",
    attachments: [],
    video: {
      url: "https://cdn.example.com/video.m3u8",
      hlsUrl: "https://cdn.example.com/video.m3u8",
      type: "hls",
    },
  });
  const stateLesson = { id: 8, status: "pending", retryCount: 0 };
  const database = {
    close: vi.fn(),
    getLessonByUrl: vi.fn(() => stateLesson),
    markLessonDownloaded: vi.fn(),
    markLessonSkipped: vi.fn(),
  };
  mocks.initializeCourseState.mockReturnValue({
    key: "learningsuite-academy-example-com-course-id",
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

describe("syncLearningSuiteCommand state tracking", () => {
  it("persists structure, tracks scan readiness, and records download outcomes", async () => {
    await syncLearningSuiteCommand(courseUrl, {});

    expect(mocks.initializeCourseState).toHaveBeenCalledWith(
      "learningsuite",
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
      8,
      expect.objectContaining({ lessonId: 8 })
    );
    expect(mocks.recordVideoDownloadResult).toHaveBeenCalledOnce();
    expect(mocks.browserClose).toHaveBeenCalledOnce();
  });
});
