import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import {
  createFolderName,
  extractLessons,
  extractModulesFromPage,
  getClassroomBaseUrl,
  isModuleUrl,
  slugify,
} from "./navigator.js";

function attachedContentWait(): {
  locator: ReturnType<typeof vi.fn>;
  waitFor: ReturnType<typeof vi.fn>;
} {
  const waitFor = vi.fn().mockResolvedValue(undefined);
  const locator = vi.fn().mockReturnValue({
    first: vi.fn().mockReturnValue({ waitFor }),
  });
  return { locator, waitFor };
}

describe("Skool navigation readiness", () => {
  it("waits for lesson content after navigating to a module", async () => {
    const { locator, waitFor } = attachedContentWait();
    const page = {
      url: vi.fn().mockReturnValue("https://www.skool.com/community/classroom"),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      locator,
      evaluate: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce([
          {
            name: "Ready lesson",
            slug: "lesson-1",
            href: "https://www.skool.com/community/classroom/a1b2c3d4?md=lesson-1",
          },
        ]),
    } as unknown as Page;

    await expect(
      extractLessons(page, "https://www.skool.com/community/classroom/a1b2c3d4")
    ).resolves.toHaveLength(1);

    expect(waitFor).toHaveBeenCalledWith({ state: "attached", timeout: 5000 });
  });

  it("waits for module content before reading the overview", async () => {
    const { locator, waitFor } = attachedContentWait();
    const page = {
      locator,
      evaluate: vi.fn().mockResolvedValue([
        {
          name: "Module 1",
          slug: "a1b2c3d4",
          url: "https://www.skool.com/community/classroom/a1b2c3d4",
          isLocked: false,
        },
      ]),
    } as unknown as Page;

    await expect(extractModulesFromPage(page)).resolves.toHaveLength(1);

    expect(waitFor).toHaveBeenCalledWith({ state: "attached", timeout: 5000 });
  });
});

describe("slugify", () => {
  it("converts to lowercase", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("replaces spaces with hyphens", () => {
    expect(slugify("hello world test")).toBe("hello-world-test");
  });

  it("removes special characters", () => {
    expect(slugify("Hello! World? Test.")).toBe("hello-world-test");
  });

  it("handles German umlauts", () => {
    expect(slugify("Größe")).toBe("groesse");
    expect(slugify("Über")).toBe("ueber");
    expect(slugify("Änderung")).toBe("aenderung");
    expect(slugify("Straße")).toBe("strasse");
  });

  it("collapses multiple hyphens", () => {
    expect(slugify("hello   world")).toBe("hello-world");
    expect(slugify("hello---world")).toBe("hello-world");
  });

  it("removes leading and trailing hyphens", () => {
    expect(slugify("  hello world  ")).toBe("hello-world");
    expect(slugify("---hello---")).toBe("hello");
  });

  it("truncates to 100 characters", () => {
    const longString = "a".repeat(150);
    const result = slugify(longString);
    expect(result.length).toBeLessThanOrEqual(100);
  });

  it("handles numbers", () => {
    expect(slugify("Lesson 1: Introduction")).toBe("lesson-1-introduction");
  });

  it("handles empty string", () => {
    expect(slugify("")).toBe("");
  });

  it("handles string with only special characters", () => {
    // @sindresorhus/slugify converts & to "and"
    expect(slugify("!@#$%^&*()")).toBe("and");
    // Pure symbols without & become empty
    expect(slugify("!@#$%^*()")).toBe("");
  });
});

describe("createFolderName", () => {
  it("creates folder name with zero-padded index", () => {
    expect(createFolderName(0, "Introduction")).toBe("01-introduction");
    expect(createFolderName(9, "Advanced Topics")).toBe("10-advanced-topics");
  });

  it("handles double-digit indices", () => {
    expect(createFolderName(99, "Last Module")).toBe("100-last-module");
  });

  it("applies slugify to name", () => {
    expect(createFolderName(0, "Hello World!")).toBe("01-hello-world");
  });

  it("handles German characters in name", () => {
    expect(createFolderName(0, "Einführung")).toBe("01-einfuehrung");
  });

  it("handles empty name", () => {
    expect(createFolderName(0, "")).toBe("01-");
  });
});

describe("isModuleUrl", () => {
  it("detects module URL with 8-char hex slug", () => {
    const result = isModuleUrl("https://www.skool.com/community/classroom/a1b2c3d4");
    expect(result).toEqual({ isModule: true, moduleSlug: "a1b2c3d4" });
  });

  it("detects module URL with query params", () => {
    const result = isModuleUrl("https://www.skool.com/community/classroom/deadbeef?md=abc");
    expect(result).toEqual({ isModule: true, moduleSlug: "deadbeef" });
  });

  it("returns false for classroom root", () => {
    const result = isModuleUrl("https://www.skool.com/community/classroom");
    expect(result).toEqual({ isModule: false, moduleSlug: null });
  });

  it("returns false for non-classroom URLs", () => {
    const result = isModuleUrl("https://www.skool.com/community/about");
    expect(result).toEqual({ isModule: false, moduleSlug: null });
  });

  it("only matches valid hex slugs", () => {
    // "zzzzzzzz" is not hex
    const result = isModuleUrl("https://www.skool.com/community/classroom/zzzzzzzz");
    expect(result).toEqual({ isModule: false, moduleSlug: null });
  });
});

describe("getClassroomBaseUrl", () => {
  it("removes module slug from URL", () => {
    const result = getClassroomBaseUrl("https://www.skool.com/community/classroom/a1b2c3d4");
    expect(result).toBe("https://www.skool.com/community/classroom");
  });

  it("removes module slug and query params", () => {
    const result = getClassroomBaseUrl("https://www.skool.com/community/classroom/a1b2c3d4?md=xyz");
    expect(result).toBe("https://www.skool.com/community/classroom");
  });

  it("keeps URL unchanged if no module slug", () => {
    const result = getClassroomBaseUrl("https://www.skool.com/community/classroom");
    expect(result).toBe("https://www.skool.com/community/classroom");
  });
});
