import { describe, expect, it } from "vitest";
import { extractLoomVideoId, formatMarkdown } from "./extractor.js";

describe("extractLoomVideoId", () => {
  it("extracts ID from embed URL", () => {
    const url = "https://www.loom.com/embed/abc123def456";
    expect(extractLoomVideoId(url)).toBe("abc123def456");
  });

  it("extracts ID from embed URL with query params", () => {
    const url = "https://www.loom.com/embed/abc123def456?autoplay=1";
    expect(extractLoomVideoId(url)).toBe("abc123def456");
  });

  it("returns null for invalid URL", () => {
    expect(extractLoomVideoId("https://youtube.com/watch?v=123")).toBeNull();
  });

  it("returns null for non-embed loom URL", () => {
    // Note: extractLoomVideoId only handles embed URLs
    expect(extractLoomVideoId("https://loom.com/share/abc123")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractLoomVideoId("")).toBeNull();
  });

  it("handles URL without www prefix", () => {
    const url = "https://loom.com/embed/abc123def456";
    expect(extractLoomVideoId(url)).toBe("abc123def456");
  });
});

describe("formatMarkdown", () => {
  it("creates markdown with title", () => {
    const result = formatMarkdown("My Lesson", "", null, null);
    expect(result).toBe("# My Lesson");
  });

  it("includes video link when present", () => {
    const result = formatMarkdown("My Lesson", "", "https://loom.com/embed/123", "loom");
    expect(result).toContain("# My Lesson");
    expect(result).toContain("📺 Loom: https://loom.com/embed/123");
  });

  it("includes content when present", () => {
    const result = formatMarkdown("My Lesson", "Some content here", null, null);
    expect(result).toContain("# My Lesson");
    expect(result).toContain("Some content here");
  });

  it("capitalizes video type label", () => {
    const result = formatMarkdown("Test", "", "https://example.com", "vimeo");
    expect(result).toContain("Vimeo:");
  });

  it("uses generic 'Video' label when type is null", () => {
    const result = formatMarkdown("Test", "", "https://example.com", null);
    expect(result).toContain("Video:");
  });

  it("cleans up excessive newlines", () => {
    const result = formatMarkdown("Test", "Line 1\n\n\n\n\nLine 2", null, null);
    expect(result).not.toContain("\n\n\n");
  });

  it("combines all parts correctly", () => {
    const result = formatMarkdown(
      "Full Lesson",
      "This is the lesson content.",
      "https://vimeo.com/123",
      "vimeo"
    );

    expect(result).toContain("# Full Lesson");
    expect(result).toContain("📺 Vimeo: https://vimeo.com/123");
    expect(result).toContain("This is the lesson content.");
  });

  it("trims final result", () => {
    const result = formatMarkdown("Test", "Content   ", null, null);
    expect(result).not.toMatch(/\s+$/);
  });
});
