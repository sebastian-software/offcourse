import { describe, expect, it } from "vitest";
import { extractVimeoId } from "./vimeoDownloader.js";

describe("extractVimeoId", () => {
  it("extracts ID from standard vimeo.com URL", () => {
    const url = "https://vimeo.com/123456789";
    expect(extractVimeoId(url)).toBe("123456789");
  });

  it("extracts ID from vimeo.com/video URL", () => {
    const url = "https://vimeo.com/video/123456789";
    expect(extractVimeoId(url)).toBe("123456789");
  });

  it("extracts ID from player.vimeo.com URL", () => {
    const url = "https://player.vimeo.com/video/987654321";
    expect(extractVimeoId(url)).toBe("987654321");
  });

  it("extracts ID from channel URL", () => {
    const url = "https://vimeo.com/channels/staffpicks/123456789";
    expect(extractVimeoId(url)).toBe("123456789");
  });

  it("extracts ID from groups URL", () => {
    const url = "https://vimeo.com/groups/shortfilms/videos/123456789";
    expect(extractVimeoId(url)).toBe("123456789");
  });

  it("extracts ID from URL with query params", () => {
    const url = "https://vimeo.com/123456789?share=copy&autoplay=1";
    expect(extractVimeoId(url)).toBe("123456789");
  });

  it("extracts ID from URL with hash for unlisted videos", () => {
    const url = "https://vimeo.com/123456789/abcdef1234";
    expect(extractVimeoId(url)).toBe("123456789");
  });

  it("extracts ID from player URL with h parameter", () => {
    const url = "https://player.vimeo.com/video/123456789?h=abcdef1234";
    expect(extractVimeoId(url)).toBe("123456789");
  });

  it("returns null for non-Vimeo URL", () => {
    expect(extractVimeoId("https://youtube.com/watch?v=abc123")).toBeNull();
    expect(extractVimeoId("https://loom.com/embed/abc123")).toBeNull();
  });

  it("returns null for Vimeo homepage", () => {
    expect(extractVimeoId("https://vimeo.com")).toBeNull();
    expect(extractVimeoId("https://vimeo.com/")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractVimeoId("")).toBeNull();
  });

  it("returns null for invalid string", () => {
    expect(extractVimeoId("not-a-url")).toBeNull();
  });
});

