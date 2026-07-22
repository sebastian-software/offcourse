import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LessonStatus } from "./database.js";
import {
  getCourseStateKey,
  initializeCourseState,
  markLessonScanReady,
  recordVideoDownloadResult,
} from "./courseState.js";

describe("getCourseStateKey", () => {
  it.each([
    ["skool", "https://www.skool.com/community/classroom", "community"],
    [
      "highlevel",
      "https://courses.example.com/courses/products/product-123/categories/a",
      "highlevel-courses-example-com-product-123",
    ],
    [
      "learningsuite",
      "https://academy.example.com/student/course/my-course/course-123/lesson-1",
      "learningsuite-academy-example-com-course-123",
    ],
    ["piccalilli", "https://piccalil.li/mindful-design/lessons/2", "piccalilli-mindful-design"],
    [
      "joshcomeau",
      "https://courses.joshwcomeau.com/css-for-js/module/lesson",
      "joshcomeau-css-for-js",
    ],
  ] as const)("derives a stable %s key", (platform, url, expected) => {
    expect(getCourseStateKey(platform, url)).toBe(expected);
  });
});

describe("initializeCourseState", () => {
  let directory: string;

  afterEach(() => {
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it("persists generic structures and queues failed lessons for retry", () => {
    directory = mkdtempSync(join(tmpdir(), "offcourse-course-state-"));
    const sourceUrl = "https://courses.example.com/courses/products/course-id";
    const structure = {
      name: "Course",
      url: sourceUrl,
      modules: [
        {
          slug: "module-id",
          name: "Module",
          position: 0,
          lessons: [
            {
              slug: "lesson-id",
              name: "Lesson",
              url: "https://example.com/lesson-id",
              position: 0,
            },
          ],
        },
      ],
    };
    const first = initializeCourseState("highlevel", sourceUrl, structure, {
      databasePath: join(directory, "course.db"),
    });
    const lesson = first.lessonsByUrl.get("https://example.com/lesson-id");
    if (!lesson) throw new Error("Expected persisted lesson");
    expect(lesson).toMatchObject({ status: LessonStatus.PENDING });
    first.database.markLessonError(lesson.id, "failed", "DOWNLOAD_ERROR");
    first.database.incrementRetryCount(lesson.id);
    first.database.close();

    const resumed = initializeCourseState("highlevel", sourceUrl, structure, {
      retryFailed: true,
      databasePath: join(directory, "course.db"),
    });
    expect(resumed.lessonsByUrl.get("https://example.com/lesson-id")).toMatchObject({
      id: lesson.id,
      status: LessonStatus.PENDING,
      retryCount: 1,
    });
    expect(resumed.retryLessonIds).toEqual(new Set([lesson.id]));
    resumed.database.close();
  });

  it("records provider-neutral scan and download outcomes without signed URL secrets", () => {
    directory = mkdtempSync(join(tmpdir(), "offcourse-course-state-"));
    const sourceUrl = "https://courses.example.com/courses/products/course-id";
    const state = initializeCourseState(
      "highlevel",
      sourceUrl,
      {
        name: "Course",
        url: sourceUrl,
        modules: [
          {
            slug: "module-id",
            name: "Module",
            position: 0,
            lessons: [
              {
                slug: "lesson-id",
                name: "Lesson",
                url: "https://example.com/lesson-id",
                position: 0,
              },
            ],
          },
        ],
      },
      { databasePath: join(directory, "course.db") }
    );
    const lesson = state.lessonsByUrl.get("https://example.com/lesson-id");
    if (!lesson) throw new Error("Expected persisted lesson");
    const task = {
      lessonId: lesson.id,
      lessonName: "Lesson",
      videoUrl: "https://cdn.example.com/video.m3u8?token=secret",
      videoType: "hls" as const,
      outputPath: "/tmp/video.mp4",
    };

    markLessonScanReady(state.database, task.lessonId, task);
    expect(state.database.getLessonByUrl("https://example.com/lesson-id")).toMatchObject({
      status: LessonStatus.VALIDATED,
      videoType: "hls",
      videoUrl: "https://cdn.example.com/video.m3u8",
      hlsUrl: null,
    });

    recordVideoDownloadResult(state.database, task, {
      success: false,
      error: "Playlist failed: https://cdn.example.com/video.m3u8?token=secret",
      errorCode: "PLAYLIST_ERROR",
    });
    expect(state.database.getLessonByUrl("https://example.com/lesson-id")).toMatchObject({
      status: LessonStatus.ERROR,
      errorMessage: "Playlist failed: https://cdn.example.com/video.m3u8",
      errorCode: "PLAYLIST_ERROR",
      retryCount: 1,
    });

    recordVideoDownloadResult(state.database, task, { success: true });
    expect(state.database.getLessonByUrl("https://example.com/lesson-id")).toMatchObject({
      status: LessonStatus.DOWNLOADED,
    });
    state.database.close();
  });

  it("migrates legacy LearningSuite module slugs without orphaning lessons", () => {
    directory = mkdtempSync(join(tmpdir(), "offcourse-course-state-"));
    const sourceUrl = "https://academy.example.com/student/course/course/course-123";
    const databasePath = join(directory, "course.db");
    const legacy = initializeCourseState(
      "learningsuite",
      sourceUrl,
      {
        name: "Course",
        url: sourceUrl,
        modules: [
          {
            slug: "module-0",
            name: "Module",
            position: 0,
            isLocked: true,
            lessons: [],
          },
        ],
      },
      { databasePath }
    );
    const legacyModule = legacy.database.getModuleBySlug("module-0");
    if (!legacyModule) throw new Error("Expected legacy module");
    legacy.database.close();

    const resumed = initializeCourseState(
      "learningsuite",
      sourceUrl,
      {
        name: "Course",
        url: sourceUrl,
        modules: [
          {
            slug: "module-0-stable",
            name: "Module",
            position: 0,
            isLocked: false,
            lessons: [
              {
                slug: "lesson-1",
                name: "Lesson",
                url: "https://academy.example.com/student/course/course/course-123/lesson-1",
                position: 0,
              },
            ],
          },
        ],
      },
      { databasePath }
    );

    expect(resumed.database.getModules()).toHaveLength(1);
    expect(resumed.database.getModuleBySlug("module-0-stable")).toMatchObject({
      id: legacyModule.id,
      isLocked: false,
    });
    expect(resumed.database.getModuleBySlug("module-0")).toBeNull();
    expect(resumed.database.getLessons()).toHaveLength(1);
    resumed.database.close();
  });
});
