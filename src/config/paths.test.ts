import { describe, expect, it } from "vitest";
import { homedir } from "node:os";
import { expandPath, getSessionPath, getSyncStatePath, APP_DIR } from "./paths.js";

/** Normalize path to POSIX format for cross-platform test assertions */
const toPosix = (p: string) => p.replace(/\\/g, "/");

describe("expandPath", () => {
  it("expands ~ to home directory", () => {
    const result = toPosix(expandPath("~/Downloads/offcourse"));
    expect(result).toBe(`${toPosix(homedir())}/Downloads/offcourse`);
  });

  it("expands ~/nested/path correctly", () => {
    const result = toPosix(expandPath("~/foo/bar/baz"));
    expect(result).toBe(`${toPosix(homedir())}/foo/bar/baz`);
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
    const result = toPosix(getSessionPath("example.com"));
    expect(result).toBe(`${toPosix(APP_DIR)}/sessions/example.com.json`);
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
    const result = toPosix(getSyncStatePath("my-course"));
    expect(result).toBe(`${toPosix(APP_DIR)}/sync-state/my-course.json`);
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
