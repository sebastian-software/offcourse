import { describe, expect, it } from "vitest";
import { isHighLevelPortal, formatHighLevelMarkdown } from "./syncHighLevel.js";

describe("isHighLevelPortal", () => {
  describe("detects HighLevel portal patterns", () => {
    it("detects member.*.com domains", () => {
      expect(isHighLevelPortal("https://member.example.com/courses")).toBe(true);
      expect(isHighLevelPortal("https://member.myschool.com")).toBe(true);
    });

    it("detects portal.*.com domains", () => {
      expect(isHighLevelPortal("https://portal.academy.com/courses")).toBe(true);
    });

    it("detects courses.*.com domains", () => {
      expect(isHighLevelPortal("https://courses.school.com/products/123")).toBe(true);
    });

    it("detects clientclub.net", () => {
      expect(isHighLevelPortal("https://sso.clientclub.net/login")).toBe(true);
      expect(isHighLevelPortal("https://app.clientclub.net")).toBe(true);
    });

    it("detects highlevel.io", () => {
      expect(isHighLevelPortal("https://app.highlevel.io")).toBe(true);
    });

    it("detects leadconnectorhq.com", () => {
      expect(isHighLevelPortal("https://api.leadconnectorhq.com")).toBe(true);
    });
  });

  describe("detects HighLevel URL patterns", () => {
    it("detects /courses/products path", () => {
      expect(isHighLevelPortal("https://custom.domain.com/courses/products/abc-123")).toBe(true);
    });

    it("detects /courses/library path", () => {
      expect(isHighLevelPortal("https://school.io/courses/library")).toBe(true);
    });

    it("detects /courses/classroom path", () => {
      expect(isHighLevelPortal("https://learn.site.com/courses/classroom")).toBe(true);
    });
  });

  describe("rejects non-HighLevel URLs", () => {
    it("rejects Skool URLs", () => {
      expect(isHighLevelPortal("https://www.skool.com/community")).toBe(false);
    });

    it("matches courses.* subdomains (may include Teachable)", () => {
      // Note: courses.*.com pattern is intentionally broad
      // Teachable courses subdomain matches the pattern
      expect(isHighLevelPortal("https://courses.teachable.com")).toBe(true);
      // But teachable.com root doesn't match
      expect(isHighLevelPortal("https://teachable.com/course")).toBe(false);
    });

    it("rejects Kajabi URLs", () => {
      expect(isHighLevelPortal("https://app.kajabi.com")).toBe(false);
    });

    it("rejects generic URLs", () => {
      expect(isHighLevelPortal("https://example.com")).toBe(false);
      expect(isHighLevelPortal("https://youtube.com/watch?v=123")).toBe(false);
    });

    it("rejects empty string", () => {
      expect(isHighLevelPortal("")).toBe(false);
    });
  });
});

describe("formatHighLevelMarkdown", () => {
  it("formats basic lesson with title only", () => {
    const result = formatHighLevelMarkdown("Introduction", null, null);
    expect(result).toBe("# Introduction\n");
  });

  it("includes description when present", () => {
    const result = formatHighLevelMarkdown("Getting Started", "Welcome to the course!", null);

    expect(result).toContain("# Getting Started");
    expect(result).toContain("Welcome to the course!");
  });

  it("includes video section when URL present", () => {
    const result = formatHighLevelMarkdown(
      "Video Lesson",
      null,
      null,
      "https://storage.example.com/video.mp4"
    );

    expect(result).toContain("## Video");
    expect(result).toContain("Video URL: https://storage.example.com/video.mp4");
  });

  it("converts HTML content to text", () => {
    const html = "<p>First paragraph.</p><p>Second paragraph.</p>";
    const result = formatHighLevelMarkdown("Lesson", null, html);

    expect(result).toContain("First paragraph.");
    expect(result).toContain("Second paragraph.");
    expect(result).not.toContain("<p>");
  });

  it("converts HTML lists to markdown", () => {
    const html = "<ul><li>Item 1</li><li>Item 2</li></ul>";
    const result = formatHighLevelMarkdown("Lesson", null, html);

    expect(result).toContain("- Item 1");
    expect(result).toContain("- Item 2");
  });

  it("decodes HTML entities", () => {
    const html = "<p>Tom &amp; Jerry &lt;3 &quot;cartoons&quot;</p>";
    const result = formatHighLevelMarkdown("Lesson", null, html);

    expect(result).toContain('Tom & Jerry <3 "cartoons"');
  });

  it("snapshot: complete lesson with all parts", () => {
    const result = formatHighLevelMarkdown(
      "Complete Module: Advanced Techniques",
      "In this comprehensive module, you'll learn advanced strategies.",
      "<p>Let's dive into the key concepts:</p><ul><li>Concept A</li><li>Concept B</li><li>Concept C</li></ul><p>Remember to practice daily!</p>",
      "https://cdn.example.com/videos/advanced-techniques.mp4"
    );

    expect(result).toMatchSnapshot();
  });

  it("snapshot: lesson with HTML entities and special chars", () => {
    const result = formatHighLevelMarkdown(
      "Q&A Session: Common Questions",
      "Your questions answered!",
      "<p>Q: What&apos;s the best approach?</p><p>A: It depends on your goals &amp; resources.</p><p>&nbsp;</p><p>&lt;script&gt; tags are blocked</p>"
    );

    expect(result).toMatchSnapshot();
  });
});
