import { describe, expect, it } from "vitest";
import { extractQueryParams, getBaseUrl, resolveUrl, resolveUrlWithParams } from "./url.js";

describe("extractQueryParams", () => {
  it("extracts query string with leading ?", () => {
    expect(extractQueryParams("https://example.com/path?foo=bar")).toBe("?foo=bar");
  });

  it("extracts multiple query params", () => {
    expect(extractQueryParams("https://example.com?a=1&b=2&c=3")).toBe("?a=1&b=2&c=3");
  });

  it("returns empty string when no query params", () => {
    expect(extractQueryParams("https://example.com/path")).toBe("");
  });

  it("returns empty string for empty input", () => {
    expect(extractQueryParams("")).toBe("");
  });

  it("handles URL with fragment after query", () => {
    expect(extractQueryParams("https://example.com?foo=bar#section")).toBe("?foo=bar#section");
  });

  it("handles query string only (no path)", () => {
    expect(extractQueryParams("?token=abc123")).toBe("?token=abc123");
  });
});

describe("getBaseUrl", () => {
  it("extracts base URL up to last slash", () => {
    expect(getBaseUrl("https://cdn.example.com/videos/playlist.m3u8")).toBe(
      "https://cdn.example.com/videos/"
    );
  });

  it("handles URL with query params", () => {
    expect(getBaseUrl("https://cdn.example.com/path/file.ts?token=abc")).toBe(
      "https://cdn.example.com/path/"
    );
  });

  it("handles root URL", () => {
    expect(getBaseUrl("https://example.com/")).toBe("https://example.com/");
  });

  it("handles URL without trailing path", () => {
    // Returns up to last slash (the // in https://)
    expect(getBaseUrl("https://example.com")).toBe("https://");
  });

  it("handles empty string", () => {
    expect(getBaseUrl("")).toBe("");
  });

  it("handles deeply nested paths", () => {
    expect(getBaseUrl("https://cdn.com/a/b/c/d/file.m3u8")).toBe("https://cdn.com/a/b/c/d/");
  });
});

describe("resolveUrl", () => {
  it("returns absolute URL unchanged", () => {
    expect(resolveUrl("https://other.com/file.ts", "https://cdn.com/")).toBe(
      "https://other.com/file.ts"
    );
  });

  it("resolves relative URL against base", () => {
    expect(resolveUrl("segment001.ts", "https://cdn.example.com/videos/")).toBe(
      "https://cdn.example.com/videos/segment001.ts"
    );
  });

  it("handles http:// URLs", () => {
    expect(resolveUrl("http://insecure.com/file.ts", "https://cdn.com/")).toBe(
      "http://insecure.com/file.ts"
    );
  });

  it("handles empty relative URL", () => {
    expect(resolveUrl("", "https://cdn.com/path/")).toBe("https://cdn.com/path/");
  });

  it("handles relative path with subdirectory", () => {
    expect(resolveUrl("sub/segment.ts", "https://cdn.com/videos/")).toBe(
      "https://cdn.com/videos/sub/segment.ts"
    );
  });
});

describe("resolveUrlWithParams", () => {
  it("appends query params to resolved URL", () => {
    expect(resolveUrlWithParams("segment.ts", "https://cdn.com/", "?token=abc")).toBe(
      "https://cdn.com/segment.ts?token=abc"
    );
  });

  it("does not duplicate params if URL already has them", () => {
    expect(resolveUrlWithParams("segment.ts?existing=1", "https://cdn.com/", "?token=abc")).toBe(
      "https://cdn.com/segment.ts?existing=1"
    );
  });

  it("handles absolute URL with params", () => {
    expect(
      resolveUrlWithParams("https://other.com/file.ts", "https://cdn.com/", "?token=abc")
    ).toBe("https://other.com/file.ts?token=abc");
  });

  it("handles empty query params", () => {
    expect(resolveUrlWithParams("segment.ts", "https://cdn.com/", "")).toBe(
      "https://cdn.com/segment.ts"
    );
  });

  it("works with complex signed URL tokens", () => {
    const token = "?Policy=xxx&Signature=yyy&Key-Pair-Id=zzz";
    expect(resolveUrlWithParams("video/720p.m3u8", "https://cdn.com/hls/", token)).toBe(
      "https://cdn.com/hls/video/720p.m3u8?Policy=xxx&Signature=yyy&Key-Pair-Id=zzz"
    );
  });
});
