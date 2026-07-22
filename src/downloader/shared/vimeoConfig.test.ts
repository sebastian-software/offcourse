import { describe, expect, it } from "vitest";
import { selectVimeoHlsUrl, selectVimeoProgressiveUrl } from "./vimeoConfig.js";

describe("selectVimeoHlsUrl", () => {
  it("prefers AVC from the configured CDN before the standard CDN order", () => {
    expect(
      selectVimeoHlsUrl({
        default_cdn: "custom",
        cdns: {
          custom: { url: "https://cdn.example/custom.m3u8" },
          fastly_skyfire: {
            avc_url: "https://cdn.example/fastly-avc.m3u8",
            url: "https://cdn.example/fastly.m3u8",
          },
        },
      })
    ).toBe("https://cdn.example/custom.m3u8");
  });

  it("uses an AVC URL from a fallback CDN when the preferred CDN is absent", () => {
    expect(
      selectVimeoHlsUrl({
        cdns: {
          custom: { avc_url: "https://cdn.example/avc.m3u8", url: "https://cdn.example/hevc.m3u8" },
        },
      })
    ).toBe("https://cdn.example/avc.m3u8");
  });

  it("returns null when no Vimeo HLS CDN is available", () => {
    expect(selectVimeoHlsUrl({ cdns: {} })).toBeNull();
  });
});

describe("selectVimeoProgressiveUrl", () => {
  it("selects the highest-resolution rendition", () => {
    expect(
      selectVimeoProgressiveUrl([
        { height: 360, url: "https://cdn.example/360.mp4" },
        { height: 1080, url: "https://cdn.example/1080.mp4" },
      ])
    ).toBe("https://cdn.example/1080.mp4");
  });
});
