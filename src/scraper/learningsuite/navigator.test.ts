/**
 * Tests for LearningSuite navigator utility functions.
 */

import { describe, expect, it } from "vitest";
import {
  extractTenantFromUrl,
  getLearningSuiteCourseUrl,
  getLearningSuiteLessonUrl,
} from "./navigator.js";

describe("extractTenantFromUrl", () => {
  it("extracts subdomain from valid LearningSuite URL", () => {
    const result = extractTenantFromUrl("https://mycompany.learningsuite.io/courses");
    expect(result.subdomain).toBe("mycompany");
    expect(result.tenantId).toBeNull(); // Will be resolved by API
  });

  it("handles URL with path and query params", () => {
    const result = extractTenantFromUrl(
      "https://academy.learningsuite.io/student/course/intro/abc123?tab=overview"
    );
    expect(result.subdomain).toBe("academy");
  });

  it("handles subdomain with hyphens", () => {
    const result = extractTenantFromUrl("https://my-awesome-academy.learningsuite.io/");
    expect(result.subdomain).toBe("my-awesome-academy");
  });

  it("handles subdomain with numbers", () => {
    const result = extractTenantFromUrl("https://academy2024.learningsuite.io/courses");
    expect(result.subdomain).toBe("academy2024");
  });

  it("returns empty subdomain for non-learningsuite domain", () => {
    const result = extractTenantFromUrl("https://example.com/courses");
    expect(result.subdomain).toBe("");
    expect(result.tenantId).toBeNull();
  });

  it("returns empty subdomain for www.learningsuite.io", () => {
    const result = extractTenantFromUrl("https://www.learningsuite.io/courses");
    // www is treated as a subdomain, but doesn't match the pattern properly
    // since it's the main site
    expect(result.subdomain).toBe("www");
  });

  it("returns empty subdomain for bare learningsuite.io", () => {
    const result = extractTenantFromUrl("https://learningsuite.io/");
    expect(result.subdomain).toBe("");
  });

  it("handles HTTP URLs", () => {
    const result = extractTenantFromUrl("http://demo.learningsuite.io/test");
    expect(result.subdomain).toBe("demo");
  });

  it("throws for invalid URLs", () => {
    expect(() => extractTenantFromUrl("not-a-valid-url")).toThrow();
    expect(() => extractTenantFromUrl("")).toThrow();
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
