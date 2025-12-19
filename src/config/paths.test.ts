import { describe, expect, it } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { expandPath, getSessionPath, getSyncStatePath } from "./paths.js";

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
    // Edge case: just "~" without slash should not be expanded
    const result = expandPath("~");
    expect(result).toBe("~");
  });

  it("handles empty string", () => {
    const result = expandPath("");
    expect(result).toBe("");
  });
});

describe("getSessionPath", () => {
  it("generates correct session path for simple domain", () => {
    const result = getSessionPath("example.com");
    expect(result).toMatch(/\.offcourse\/sessions\/example\.com\.json$/);
  });

  it("sanitizes domains with special characters", () => {
    const result = getSessionPath("sub.domain.com");
    expect(result).toMatch(/sub\.domain\.com\.json$/);
  });

  it("replaces invalid filesystem characters with underscores", () => {
    const result = getSessionPath("example.com/path?query");
    expect(result).toMatch(/example\.com_path_query\.json$/);
  });

  it("handles domains with ports", () => {
    const result = getSessionPath("localhost:3000");
    expect(result).toMatch(/localhost_3000\.json$/);
  });
});

describe("getSyncStatePath", () => {
  it("generates correct sync state path for simple slug", () => {
    const result = getSyncStatePath("my-course");
    expect(result).toMatch(/\.offcourse\/sync-state\/my-course\.json$/);
  });

  it("sanitizes slugs with special characters", () => {
    const result = getSyncStatePath("Course Name: Special!");
    expect(result).toMatch(/Course_Name__Special_\.json$/);
  });

  it("handles slugs with only valid characters", () => {
    const result = getSyncStatePath("valid-slug-123");
    expect(result).toMatch(/valid-slug-123\.json$/);
  });
});

