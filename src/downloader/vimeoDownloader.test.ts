import { describe, expect, it } from "vitest";
import { extractVimeoId, parseVimeoConfig } from "./vimeoDownloader.js";

describe("parseVimeoConfig", () => {
  it("prefers the configured Vimeo CDN and highest progressive rendition", () => {
    const result = parseVimeoConfig(
      {
        video: { title: "Course video", duration: 42, width: 1280, height: 720 },
        request: {
          files: {
            hls: {
              cdns: {
                fallback: { url: "https://fallback.test/master.m3u8" },
                fastly_skyfire: { url: "https://preferred.test/master.m3u8" },
              },
            },
            progressive: [
              { height: 360, url: "https://cdn.test/360.mp4" },
              { height: 1080, url: "https://cdn.test/1080.mp4" },
            ],
          },
        },
      },
      "123"
    );

    expect(result).toMatchObject({
      success: true,
      info: {
        id: "123",
        title: "Course video",
        hlsUrl: "https://preferred.test/master.m3u8",
        progressiveUrl: "https://cdn.test/1080.mp4",
      },
    });
  });

  it("falls back to the first available HLS CDN", () => {
    expect(
      parseVimeoConfig(
        { request: { files: { hls: { cdns: { custom: { url: "https://custom.test/hls" } } } } } },
        "123"
      )
    ).toMatchObject({ success: true, info: { hlsUrl: "https://custom.test/hls" } });
  });

  it("reports DASH-only configs as DRM protected", () => {
    expect(
      parseVimeoConfig(
        { video: { title: "Protected" }, request: { files: { dash: { cdns: {} } } } },
        "123"
      )
    ).toMatchObject({ success: false, errorCode: "DRM_PROTECTED" });
  });

  it("reports configs without downloadable streams", () => {
    expect(parseVimeoConfig({}, "123")).toMatchObject({
      success: false,
      errorCode: "PARSE_ERROR",
    });
  });
});

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
