import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  hasLessonsPendingDownload,
  hasLessonsPendingValidation,
  persistCourseStructure,
  redactDownloadUrl,
  redactDownloadUrlsInText,
  shouldPreserveRetryError,
} from "./sync.js";
import { CourseDatabase, LessonStatus } from "../../state/database.js";
import type { CourseStructure } from "../../scraper/navigator.js";

describe("hasLessonsPendingValidation", () => {
  it("starts validation for newly inserted pending lessons", () => {
    const getLessonsToScan = vi.fn(() => [{} as never]);

    expect(hasLessonsPendingValidation({ getLessonsToScan })).toBe(true);
    expect(getLessonsToScan).toHaveBeenCalledOnce();
  });

  it("skips validation only when no lesson needs scanning", () => {
    const getLessonsToScan = vi.fn(() => []);

    expect(hasLessonsPendingValidation({ getLessonsToScan })).toBe(false);
  });
});

describe("hasLessonsPendingDownload", () => {
  it("resumes validated lessons without an HLS URL", () => {
    const getLessonsByStatus = vi.fn(() => [{} as never]);

    expect(hasLessonsPendingDownload({ getLessonsByStatus })).toBe(true);
    expect(getLessonsByStatus).toHaveBeenCalledWith(LessonStatus.VALIDATED);
  });

  it("skips download work only when no lesson is validated", () => {
    const getLessonsByStatus = vi.fn(() => []);

    expect(hasLessonsPendingDownload({ getLessonsByStatus })).toBe(false);
  });
});

describe("shouldPreserveRetryError", () => {
  it("preserves the existing error after shutdown", () => {
    expect(shouldPreserveRetryError(false)).toBe(true);
  });

  it("records a new error for an unexpected page closure", () => {
    expect(shouldPreserveRetryError(true)).toBe(false);
  });
});

describe("redactDownloadUrl", () => {
  it("removes signed query parameters, fragments, and user info", () => {
    expect(
      redactDownloadUrl(
        "https://user:password@cdn.example.com/video.m3u8?token=secret&expires=123#segment"
      )
    ).toBe("https://cdn.example.com/video.m3u8");
  });

  it("fully redacts opaque and invalid URLs", () => {
    expect(redactDownloadUrl("segments:c2VjcmV0LXNpZ25lZC11cmw=")).toBe("segments:[redacted]");
    expect(redactDownloadUrl("not a valid url?token=secret")).toBe("[redacted]");
  });

  it("redacts signed URLs embedded in diagnostic text", () => {
    expect(
      redactDownloadUrlsInText(
        "Playlist failed (https://cdn.example.com/video.m3u8?token=secret); fallback segments:c2VjcmV0."
      )
    ).toBe("Playlist failed (https://cdn.example.com/video.m3u8); fallback segments:[redacted].");
  });
});

describe("persistCourseStructure", () => {
  const structure: CourseStructure = {
    name: "Test course",
    url: "https://www.skool.com/test-course/classroom",
    modules: [
      {
        name: "Module 1",
        slug: "module-1",
        url: "https://www.skool.com/test-course/classroom/module-1",
        isLocked: false,
        lessons: [
          {
            name: "Lesson 1",
            slug: "lesson-1",
            url: "https://www.skool.com/test-course/classroom/lesson-1",
            index: 0,
            isLocked: false,
          },
          {
            name: "Lesson 2",
            slug: "lesson-2",
            url: "https://www.skool.com/test-course/classroom/lesson-2",
            index: 1,
            isLocked: true,
          },
        ],
      },
    ],
  };

  function withDatabase(run: (database: CourseDatabase) => void): void {
    const directory = mkdtempSync(join(tmpdir(), "offcourse-sync-state-"));
    const database = new CourseDatabase("test-course", join(directory, "course.db"));
    try {
      run(database);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }

  it("atomically persists metadata, modules, and new lessons", () => {
    withDatabase((database) => {
      expect(persistCourseStructure(database, structure)).toBe(2);
      expect(persistCourseStructure(database, structure)).toBe(0);
      expect(database.getCourseMetadata()).toMatchObject({
        name: "Test course",
        totalModules: 1,
        totalLessons: 2,
      });
      expect(database.getLessons()[1]).toMatchObject({ isLocked: true, position: 1 });
    });
  });

  it("honors the lesson limit inside the transaction", () => {
    withDatabase((database) => {
      expect(persistCourseStructure(database, structure, 1)).toBe(1);
      expect(database.getLessonCount()).toBe(1);
    });
  });

  it("rolls back the whole structure when a lesson write fails", () => {
    withDatabase((database) => {
      const upsertLesson = database.upsertLesson.bind(database);
      let writes = 0;
      vi.spyOn(database, "upsertLesson").mockImplementation(
        (...args: Parameters<CourseDatabase["upsertLesson"]>) => {
          writes++;
          if (writes === 2) throw new Error("lesson write failed");
          return upsertLesson(...args);
        }
      );

      expect(() => persistCourseStructure(database, structure)).toThrow("lesson write failed");
      expect(database.getCourseMetadata()).toMatchObject({
        name: "Unknown Course",
        totalModules: 0,
        totalLessons: 0,
      });
    });
  });
});
