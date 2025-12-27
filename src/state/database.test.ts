import { describe, expect, it } from "vitest";
import { extractCommunitySlug, getDbDir, getDbPath } from "./database.js";
import { CACHE_DIR } from "../config/paths.js";
import { join } from "node:path";

describe("extractCommunitySlug", () => {
  it("extracts slug from standard Skool URL", () => {
    expect(extractCommunitySlug("https://www.skool.com/my-community")).toBe("my-community");
  });

  it("extracts slug from Skool URL without www", () => {
    expect(extractCommunitySlug("https://skool.com/test-group")).toBe("test-group");
  });

  it("extracts slug from URL with path", () => {
    expect(extractCommunitySlug("https://www.skool.com/my-community/classroom")).toBe(
      "my-community"
    );
    expect(extractCommunitySlug("https://www.skool.com/my-community/classroom/lessons/123")).toBe(
      "my-community"
    );
  });

  it("extracts slug from URL with query params (includes params in slug)", () => {
    // Note: current implementation doesn't strip query params
    expect(extractCommunitySlug("https://www.skool.com/my-community?ref=abc")).toBe(
      "my-community?ref=abc"
    );
  });

  it("handles complex community names", () => {
    expect(extractCommunitySlug("https://skool.com/the-best-community-ever-2024")).toBe(
      "the-best-community-ever-2024"
    );
  });

  it("returns 'unknown' for non-Skool URLs", () => {
    expect(extractCommunitySlug("https://example.com/path")).toBe("unknown");
    expect(extractCommunitySlug("https://youtube.com/channel/abc")).toBe("unknown");
  });

  it("returns 'unknown' for invalid URLs", () => {
    expect(extractCommunitySlug("not-a-url")).toBe("unknown");
    expect(extractCommunitySlug("")).toBe("unknown");
  });

  it("returns 'unknown' for Skool root URL", () => {
    expect(extractCommunitySlug("https://www.skool.com/")).toBe("unknown");
    expect(extractCommunitySlug("https://www.skool.com")).toBe("unknown");
  });
});

describe("getDbDir", () => {
  it("returns the CACHE_DIR", () => {
    expect(getDbDir()).toBe(CACHE_DIR);
  });

  it("returns a string path", () => {
    const dir = getDbDir();
    expect(typeof dir).toBe("string");
    expect(dir.length).toBeGreaterThan(0);
  });
});

describe("getDbPath", () => {
  it("creates a path with .db extension", () => {
    const path = getDbPath("my-community");
    expect(path).toContain(".db");
    expect(path.endsWith(".db")).toBe(true);
  });

  it("uses the community slug in the filename", () => {
    const path = getDbPath("awesome-course");
    expect(path).toContain("awesome-course");
  });

  it("joins CACHE_DIR with the slug-based filename", () => {
    const path = getDbPath("test-slug");
    expect(path).toBe(join(CACHE_DIR, "test-slug.db"));
  });

  it("sanitizes special characters in slug", () => {
    const path = getDbPath("my/special:slug*with?chars");
    // Special chars should be replaced with underscore in the filename
    const filename = path.split(/[\\/]/).pop() ?? "";
    expect(filename).toBe("my_special_slug_with_chars.db");
    expect(filename).not.toContain("/");
    expect(filename).not.toContain(":");
    expect(filename).not.toContain("*");
    expect(filename).not.toContain("?");
  });

  it("preserves hyphens and underscores", () => {
    const path = getDbPath("my-community_2024");
    expect(path).toContain("my-community_2024");
  });

  it("handles alphanumeric slugs unchanged", () => {
    const path = getDbPath("Community123");
    expect(path).toBe(join(CACHE_DIR, "Community123.db"));
  });
});
