import { describe, expect, it } from "vitest";
import { extractLoomId } from "./loomDownloader.js";

describe("extractLoomId", () => {
  it("extracts ID from embed URL", () => {
    const url = "https://www.loom.com/embed/a1b2c3d4e5f6";
    expect(extractLoomId(url)).toBe("a1b2c3d4e5f6");
  });

  it("extracts ID from share URL", () => {
    const url = "https://www.loom.com/share/abcdef123456";
    expect(extractLoomId(url)).toBe("abcdef123456");
  });

  it("extracts ID from URL with query params", () => {
    const url = "https://www.loom.com/embed/abc123?autoplay=1&t=10";
    expect(extractLoomId(url)).toBe("abc123");
  });

  it("handles URL without www", () => {
    const url = "https://loom.com/embed/abc123def456";
    expect(extractLoomId(url)).toBe("abc123def456");
  });

  it("returns null for invalid URL", () => {
    expect(extractLoomId("https://youtube.com/watch?v=123")).toBeNull();
    expect(extractLoomId("not-a-url")).toBeNull();
  });

  it("returns null for Loom homepage", () => {
    expect(extractLoomId("https://loom.com")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractLoomId("")).toBeNull();
  });

  it("handles very long IDs", () => {
    const longId = "a".repeat(32);
    const url = `https://loom.com/embed/${longId}`;
    expect(extractLoomId(url)).toBe(longId);
  });
});
