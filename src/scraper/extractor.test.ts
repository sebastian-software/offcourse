import { describe, expect, it } from "vitest";
import {
  extractLoomVideoId,
  formatMarkdown,
  getFileType,
  convertHtmlToMarkdown,
} from "./extractor.js";

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

describe("getFileType", () => {
  it("identifies PDF files", () => {
    expect(getFileType("pdf")).toBe("pdf");
    expect(getFileType("PDF")).toBe("pdf");
  });

  it("identifies Word documents", () => {
    expect(getFileType("doc")).toBe("doc");
    expect(getFileType("docx")).toBe("docx");
  });

  it("identifies Excel files", () => {
    expect(getFileType("xls")).toBe("xls");
    expect(getFileType("xlsx")).toBe("xlsx");
  });

  it("identifies PowerPoint files", () => {
    expect(getFileType("ppt")).toBe("ppt");
    expect(getFileType("pptx")).toBe("pptx");
  });

  it("identifies archive files", () => {
    expect(getFileType("zip")).toBe("zip");
    expect(getFileType("rar")).toBe("zip");
    expect(getFileType("7z")).toBe("zip");
  });

  it("returns other for unknown extensions", () => {
    expect(getFileType("txt")).toBe("other");
    expect(getFileType("jpg")).toBe("other");
    expect(getFileType("mp4")).toBe("other");
  });

  it("is case-insensitive", () => {
    expect(getFileType("PDF")).toBe("pdf");
    expect(getFileType("DOCX")).toBe("docx");
    expect(getFileType("ZIP")).toBe("zip");
  });
});

describe("convertHtmlToMarkdown", () => {
  it("converts basic HTML to markdown", () => {
    const html = "<p>Hello world</p>";
    const result = convertHtmlToMarkdown(html);
    expect(result).toBe("Hello world");
  });

  it("converts headings", () => {
    const html = "<h1>Title</h1><h2>Subtitle</h2>";
    const result = convertHtmlToMarkdown(html);
    expect(result).toContain("# Title");
    expect(result).toContain("## Subtitle");
  });

  it("converts images with alt text", () => {
    const html = '<img src="https://example.com/image.png" alt="My Image">';
    const result = convertHtmlToMarkdown(html);
    expect(result).toBe("![My Image](https://example.com/image.png)");
  });

  it("converts images without alt text", () => {
    const html = '<img src="https://example.com/image.png">';
    const result = convertHtmlToMarkdown(html);
    expect(result).toBe("![](https://example.com/image.png)");
  });

  it("converts links with different text", () => {
    const html = '<a href="https://example.com">Click here</a>';
    const result = convertHtmlToMarkdown(html);
    expect(result).toBe("[Click here](https://example.com)");
  });

  it("preserves plain text for links where text equals href", () => {
    const html = '<a href="https://example.com">https://example.com</a>';
    const result = convertHtmlToMarkdown(html);
    expect(result).toBe("https://example.com");
  });

  it("handles links without href", () => {
    const html = "<a>Just text</a>";
    const result = convertHtmlToMarkdown(html);
    expect(result).toBe("Just text");
  });

  it("converts bullet lists", () => {
    const html = "<ul><li>Item 1</li><li>Item 2</li></ul>";
    const result = convertHtmlToMarkdown(html);
    // Turndown adds extra spacing, but uses our configured bullet marker
    expect(result).toContain("-");
    expect(result).toContain("Item 1");
    expect(result).toContain("Item 2");
  });

  it("converts code blocks", () => {
    const html = "<pre><code>const x = 1;</code></pre>";
    const result = convertHtmlToMarkdown(html);
    expect(result).toContain("```");
    expect(result).toContain("const x = 1;");
  });

  it("returns empty string for empty input", () => {
    expect(convertHtmlToMarkdown("")).toBe("");
    expect(convertHtmlToMarkdown("   ")).toBe("");
  });

  it("handles complex nested HTML", () => {
    const html = `
      <div>
        <h1>Lesson Title</h1>
        <p>This is a paragraph with <a href="https://example.com">a link</a>.</p>
        <img src="https://example.com/img.jpg" alt="Screenshot">
      </div>
    `;
    const result = convertHtmlToMarkdown(html);
    expect(result).toContain("# Lesson Title");
    expect(result).toContain("[a link](https://example.com)");
    expect(result).toContain("![Screenshot](https://example.com/img.jpg)");
  });
});
