import { describe, expect, it } from "vitest";
import { createFolderName, slugify } from "./navigator.js";

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
    expect(slugify("!@#$%^&*()")).toBe("");
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

