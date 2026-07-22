/**
 * Tests for LearningSuite navigator utility functions.
 */

import type { Page } from "playwright";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getLearningSuiteCourseUrl,
  getLearningSuiteLessonUrl,
  getLearningSuiteModuleSlug,
  parseLearningSuiteLessonText,
  parseLearningSuiteModulesText,
  waitForLearningSuiteLessons,
  waitForLearningSuiteModules,
} from "./navigator.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LearningSuite readiness waits", () => {
  it("waits for localized module statistics", async () => {
    vi.stubGlobal("document", { body: { innerText: "Introduction 3 LESSONS | 12 MINUTES" } });
    const waitForFunction = vi.fn(async (predicate: () => boolean) => {
      expect(predicate()).toBe(true);
    });
    const page = { waitForFunction } as unknown as Page;

    await waitForLearningSuiteModules(page);

    expect(waitForFunction).toHaveBeenCalledWith(expect.any(Function), undefined, {
      timeout: 5000,
    });
  });

  it("waits for lesson links belonging to the current course", async () => {
    vi.stubGlobal("document", {
      querySelectorAll: () => [
        { href: "https://academy.learningsuite.io/student/course/example/course-1/lesson-1" },
        { href: "https://academy.learningsuite.io/student/course/example/course-1/t/module-1" },
      ],
    });
    const waitForFunction = vi.fn(async (predicate: (id: string) => boolean, id: string) => {
      expect(predicate(id)).toBe(true);
    });
    const page = { waitForFunction } as unknown as Page;

    await waitForLearningSuiteLessons(page, "course-1");

    expect(waitForFunction).toHaveBeenCalledWith(expect.any(Function), "course-1", {
      timeout: 5000,
    });
  });

  it("preserves best-effort behavior when readiness times out", async () => {
    const page = {
      waitForFunction: vi.fn().mockRejectedValue(new Error("timed out")),
    } as unknown as Page;

    await expect(waitForLearningSuiteModules(page)).resolves.toBeUndefined();
    await expect(waitForLearningSuiteLessons(page, "course-1")).resolves.toBeUndefined();
  });
});

describe("parseLearningSuiteModulesText", () => {
  it("parses German and English module statistics", () => {
    expect(
      parseLearningSuiteModulesText(`
        Einführung
        3 LEKTIONEN | 25 MIN.
        Getting Started
        2 LESSONS | 10 MINUTES
      `)
    ).toEqual([
      { title: "Einführung", lessonCount: 3, duration: "25 Min.", isLocked: false },
      { title: "Getting Started", lessonCount: 2, duration: "10 Min.", isLocked: false },
    ]);
  });

  it("keeps duplicate module titles as separate entries", () => {
    const modules = parseLearningSuiteModulesText(`
      Resources
      1 LESSON | 5 MIN
      Resources
      2 LESSONS | 8 MINS
    `);

    expect(modules).toHaveLength(2);
    expect(modules.map((module) => module.lessonCount)).toEqual([1, 2]);
  });

  it("parses locked modules in both locales", () => {
    expect(
      parseLearningSuiteModulesText(`
        Später
        ERSCHEINT BALD
        Later
        COMING SOON
      `)
    ).toEqual([
      { title: "Später", lessonCount: 0, duration: "", isLocked: true },
      { title: "Later", lessonCount: 0, duration: "", isLocked: true },
    ]);
  });

  it("parses module statistics from an unfamiliar locale", () => {
    expect(
      parseLearningSuiteModulesText(`
        Le démarrage
        3 LEÇONS | 12 MINUTES
      `)
    ).toEqual([{ title: "Le démarrage", lessonCount: 3, duration: "12 Min.", isLocked: false }]);
  });

  it("does not treat unrelated numeric text as module statistics", () => {
    expect(parseLearningSuiteModulesText("Overview\n3 chapters | 12 exercises")).toEqual([]);
  });
});

describe("getLearningSuiteModuleSlug", () => {
  it("keeps a module identity stable for the same position and title", () => {
    expect(getLearningSuiteModuleSlug(2, "Introduction")).toBe(
      getLearningSuiteModuleSlug(2, "Introduction")
    );
    expect(getLearningSuiteModuleSlug(2, "Introduction")).not.toBe(
      getLearningSuiteModuleSlug(3, "Introduction")
    );
    expect(getLearningSuiteModuleSlug(2, "Introduction")).not.toBe(
      getLearningSuiteModuleSlug(2, "Advanced")
    );
  });
});

describe("parseLearningSuiteLessonText", () => {
  it.each([
    ["Willkommen 2 Minuten", "Willkommen", "2 Minuten"],
    ["Kurz erklärt 30 Sekunden", "Kurz erklärt", "30 Sekunden"],
    ["Welcome 2 minutes", "Welcome", "2 minutes"],
    ["Quick tour 30 seconds", "Quick tour", "30 seconds"],
  ])("strips localized duration from %s", (text, title, duration) => {
    expect(parseLearningSuiteLessonText(text)).toEqual({ title, duration });
  });

  it("keeps titles without duration metadata", () => {
    expect(parseLearningSuiteLessonText('What is "quality"?')).toEqual({
      title: 'What is "quality"?',
      duration: "",
    });
  });

  it("rejects lesson text that is too short", () => {
    expect(parseLearningSuiteLessonText("Go")).toBeNull();
  });

  it("rejects titles that are too short after removing duration metadata", () => {
    expect(parseLearningSuiteLessonText("Go 2 minutes")).toBeNull();
  });
});

describe("getLearningSuiteCourseUrl", () => {
  it("constructs correct course URL", () => {
    const result = getLearningSuiteCourseUrl(
      "academy.learningsuite.io",
      "introduction-course",
      "abc123"
    );
    expect(result).toBe(
      "https://academy.learningsuite.io/student/course/introduction-course/abc123"
    );
  });

  it("handles course slug with special characters", () => {
    const result = getLearningSuiteCourseUrl(
      "mycompany.learningsuite.io",
      "my-course-2024",
      "xyz789"
    );
    expect(result).toBe("https://mycompany.learningsuite.io/student/course/my-course-2024/xyz789");
  });
});

describe("getLearningSuiteLessonUrl", () => {
  it("constructs correct lesson URL", () => {
    const result = getLearningSuiteLessonUrl(
      "academy.learningsuite.io",
      "intro-course",
      "course123",
      "module456", // This is kept for API compatibility but not used
      "lesson789"
    );
    expect(result).toBe(
      "https://academy.learningsuite.io/student/course/intro-course/course123/lesson789"
    );
  });

  it("ignores moduleId parameter (kept for API compatibility)", () => {
    // The moduleId is unused in the URL construction
    const result1 = getLearningSuiteLessonUrl("test.learningsuite.io", "course", "c1", "m1", "l1");
    const result2 = getLearningSuiteLessonUrl("test.learningsuite.io", "course", "c1", "m2", "l1");
    // Both should produce the same URL since moduleId is ignored
    expect(result1).toBe(result2);
  });

  it("handles complex course and lesson IDs", () => {
    const result = getLearningSuiteLessonUrl(
      "edu.learningsuite.io",
      "advanced-training-program",
      "abc-123-def",
      "mod-unused",
      "topic-456-ghi"
    );
    expect(result).toBe(
      "https://edu.learningsuite.io/student/course/advanced-training-program/abc-123-def/topic-456-ghi"
    );
  });
});
