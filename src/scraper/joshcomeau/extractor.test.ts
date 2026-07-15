import { describe, expect, it } from "vitest";
import {
  chooseVimeoHlsUrl,
  extractVimeoHlsUrlFromPlayerScript,
  formatJoshComeauMarkdown,
  getJoshComeauResourceFilename,
  rewriteJoshComeauResourceLinks,
  type JoshComeauLessonContent,
} from "./extractor.js";

describe("Josh Comeau extractor", () => {
  it("selects the preferred AVC Vimeo HLS stream", () => {
    expect(
      chooseVimeoHlsUrl({
        default_cdn: "fastly_skyfire",
        cdns: {
          akfire_interconnect_quic: { url: "https://ak.example/playlist.m3u8" },
          fastly_skyfire: {
            avc_url: "https://fastly.example/avc/playlist.m3u8",
            url: "https://fastly.example/playlist.m3u8",
          },
        },
      })
    ).toBe("https://fastly.example/avc/playlist.m3u8");
    expect(chooseVimeoHlsUrl(null)).toBeNull();
  });

  it("parses Vimeo's persistent inline player configuration", () => {
    const script = `window.playerConfig = ${JSON.stringify({
      request: {
        files: {
          hls: {
            default_cdn: "fastly_skyfire",
            cdns: {
              fastly_skyfire: {
                avc_url: 'https://cdn.example/playlist.m3u8?token={abc}\\"quoted\\"',
              },
            },
          },
        },
      },
    })}; window.afterPlayerConfig = { loaded: true };`;

    expect(extractVimeoHlsUrlFromPlayerScript(script)).toBe(
      'https://cdn.example/playlist.m3u8?token={abc}\\"quoted\\"'
    );
    expect(extractVimeoHlsUrlFromPlayerScript("console.log('no config')")).toBeNull();
    expect(extractVimeoHlsUrlFromPlayerScript("window.playerConfig = {invalid}")).toBeNull();
  });

  it("formats multiple local videos before the lesson text", () => {
    const content: JoshComeauLessonContent = {
      title: "Welcome!",
      htmlContent: "<p>Hello!</p>",
      markdownContent: "Hello!",
      resources: [],
      videos: [
        {
          embedUrl: "https://player.vimeo.com/video/1",
          hlsUrl: "https://cdn.example/1.m3u8",
          referer: "https://courses.joshwcomeau.com/wham/intro/welcome",
        },
        {
          embedUrl: "https://player.vimeo.com/video/2",
          hlsUrl: "https://cdn.example/2.m3u8",
          referer: "https://courses.joshwcomeau.com/wham/intro/welcome",
        },
      ],
    };

    expect(formatJoshComeauMarkdown(content, ["01-welcome.mp4", "01-welcome-video-02.mp4"])).toBe(
      "# Welcome!\n\n" +
        "> Video 1: [Open downloaded video](./01-welcome.mp4)\n\n" +
        "> Video 2: [Open downloaded video](./01-welcome-video-02.mp4)\n\n" +
        "Hello!\n"
    );
  });

  it("sanitizes resource names and rewrites downloaded links", () => {
    expect(
      getJoshComeauResourceFilename("https://courses.joshwcomeau.com/downloads/My%20File.zip")
    ).toBe("My File.zip");
    expect(getJoshComeauResourceFilename("invalid", 2)).toBe("resource-3");
    const resource = {
      url: "https://courses.joshwcomeau.com/downloads/file.zip",
      localFilename: "01-lesson-file.zip",
    };
    const markdown = [
      "[Full URL](https://courses.joshwcomeau.com/downloads/file.zip)",
      "[Path only](/downloads/file.zip)",
      "Prose: https://courses.joshwcomeau.com/downloads/file.zip",
      "`const path = '/downloads/file.zip'`",
    ].join("\n");

    expect(rewriteJoshComeauResourceLinks(markdown, [resource])).toBe(
      [
        "[Full URL](./01-lesson-file.zip)",
        "[Path only](./01-lesson-file.zip)",
        "Prose: https://courses.joshwcomeau.com/downloads/file.zip",
        "`const path = '/downloads/file.zip'`",
      ].join("\n")
    );
  });
});
