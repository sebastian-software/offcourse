import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import {
  chooseVimeoHlsUrl,
  extractJoshComeauLesson,
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

  it("extracts interactive lessons without an unlocked-content wrapper", async () => {
    const lessonUrl =
      "https://courses.joshwcomeau.com/joy-of-react/01-fundamentals/fix-the-converter";
    const waitForSelector = vi.fn().mockResolvedValue(undefined);
    const evaluate = vi.fn().mockResolvedValue({
      title: "Fix The Converter",
      htmlContent: "<p>Interactive lesson</p>",
      embedUrls: [],
      resourceUrls: [],
    });
    const page = {
      url: () => lessonUrl,
      waitForSelector,
      evaluate,
      frames: () => [],
    } as unknown as Page;

    const content = await extractJoshComeauLesson(page, lessonUrl);

    expect(waitForSelector).toHaveBeenCalledWith(
      expect.stringContaining("LessonContent__Wrapper"),
      expect.objectContaining({ state: "attached" })
    );
    expect(evaluate).toHaveBeenCalledWith(
      expect.any(Function),
      expect.stringContaining("LessonContent__Wrapper")
    );
    expect(content.title).toBe("Fix The Converter");
    expect(content.markdownContent).toContain("Interactive lesson");
  });

  it("waits for a Vimeo player frame that attaches after the iframe", async () => {
    const lessonUrl = "https://courses.joshwcomeau.com/joy-of-react/tools-of-the-trade/navigation";
    const embedUrl = "https://player.vimeo.com/video/700226454";
    const frame = {
      url: () => embedUrl,
      waitForFunction: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue({
        hls: {
          default_cdn: "fastly_skyfire",
          cdns: { fastly_skyfire: { url: "https://cdn.example/navigation.m3u8" } },
        },
        scriptText: "",
      }),
    };
    const frames = vi.fn().mockReturnValueOnce([]).mockReturnValue([frame]);
    const waitForTimeout = vi.fn().mockResolvedValue(undefined);
    const page = {
      url: () => lessonUrl,
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue({
        title: "Navigation",
        htmlContent: "<p>Lesson</p>",
        embedUrls: [embedUrl],
        resourceUrls: [],
      }),
      frames,
      waitForTimeout,
    } as unknown as Page;

    const content = await extractJoshComeauLesson(page, lessonUrl);

    expect(waitForTimeout).toHaveBeenCalledWith(250);
    expect(frames).toHaveBeenCalledTimes(2);
    expect(content.videos[0]?.hlsUrl).toBe("https://cdn.example/navigation.m3u8");
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
