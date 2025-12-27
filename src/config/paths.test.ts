import { describe, expect, it } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { expandPath, getSessionPath, getSyncStatePath, APP_DIR } from "./paths.js";

describe("expandPath", () => {
  it("expands ~ to home directory", () => {
    const result = expandPath("~/Downloads/offcourse");
    expect(result).toBe(join(homedir(), "Downloads/offcourse"));
  });

  it("expands ~/nested/path correctly", () => {
    const result = expandPath("~/foo/bar/baz");
    expect(result).toBe(join(homedir(), "foo/bar/baz"));
  });

  it("returns absolute paths unchanged", () => {
    const result = expandPath("/usr/local/bin");
    expect(result).toBe("/usr/local/bin");
  });

  it("returns relative paths unchanged", () => {
    const result = expandPath("relative/path");
    expect(result).toBe("relative/path");
  });

  it("handles just ~ correctly", () => {
    // untildify expands ~ to home directory
    const result = expandPath("~");
    expect(result).toBe(homedir());
  });

  it("handles empty string", () => {
    const result = expandPath("");
    expect(result).toBe("");
  });
});

describe("getSessionPath", () => {
  it("generates correct session path for simple domain", () => {
    const result = getSessionPath("example.com");
    // Use platform-aware path check
    expect(result).toBe(join(APP_DIR, "sessions", "example.com.json"));
  });

  it("sanitizes domains with special characters", () => {
    const result = getSessionPath("sub.domain.com");
    expect(result.endsWith("sub.domain.com.json")).toBe(true);
  });

  it("replaces invalid filesystem characters with underscores", () => {
    const result = getSessionPath("example.com/path?query");
    expect(result.endsWith("example.com_path_query.json")).toBe(true);
  });

  it("handles domains with ports", () => {
    const result = getSessionPath("localhost:3000");
    expect(result.endsWith("localhost_3000.json")).toBe(true);
  });
});

describe("getSyncStatePath", () => {
  it("generates correct sync state path for simple slug", () => {
    const result = getSyncStatePath("my-course");
    // Use platform-aware path check
    expect(result).toBe(join(APP_DIR, "sync-state", "my-course.json"));
  });

  it("sanitizes slugs with special characters", () => {
    const result = getSyncStatePath("Course Name: Special!");
    expect(result.endsWith("Course_Name__Special_.json")).toBe(true);
  });

  it("handles slugs with only valid characters", () => {
    const result = getSyncStatePath("valid-slug-123");
    expect(result.endsWith("valid-slug-123.json")).toBe(true);
  });
});

describe("APP_DIR", () => {
  it("is defined and contains offcourse", () => {
    expect(APP_DIR).toBeDefined();
    expect(APP_DIR).toContain("offcourse");
  });
});
