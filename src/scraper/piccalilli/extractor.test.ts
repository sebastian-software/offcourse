import { describe, expect, it } from "vitest";
import {
  extractHlsUrlFromBunnyHtml,
  formatPiccalilliMarkdown,
  getPiccalilliResourceFilename,
  rewritePiccalilliResourceLinks,
  type PiccalilliLessonContent,
} from "./extractor.js";

describe("Piccalilli extractor", () => {
  it("extracts a Bunny HLS playlist from player HTML", () => {
    const html = `
      <video>
        <source src="https://vz-example.b-cdn.net/video-id/playlist.m3u8?token=abc&amp;expires=1">
      </video>
    `;
    expect(extractHlsUrlFromBunnyHtml(html)).toBe(
      "https://vz-example.b-cdn.net/video-id/playlist.m3u8?token=abc&expires=1"
    );
  });

  it("handles escaped player JSON", () => {
    expect(
      extractHlsUrlFromBunnyHtml(
        String.raw`{"src":"https:\/\/vz-example.b-cdn.net\/video-id\/playlist.m3u8"}`
      )
    ).toBe("https://vz-example.b-cdn.net/video-id/playlist.m3u8");
    expect(extractHlsUrlFromBunnyHtml("<html>No video</html>")).toBeNull();
  });

  it("derives and sanitizes course resource filenames", () => {
    expect(
      getPiccalilliResourceFilename("https://piccalil.li/downloads/type-playground.penpot")
    ).toBe("type-playground.penpot");
    expect(getPiccalilliResourceFilename("https://piccalil.li/downloads/My%20File.fig")).toBe(
      "My File.fig"
    );
    expect(getPiccalilliResourceFilename("not-a-url", 2)).toBe("resource-3");
  });

  it("formats an offline lesson with its player reference and content", () => {
    const content: PiccalilliLessonContent = {
      title: "Playing With Type Scales",
      htmlContent: "<p>Download the exercise file.</p>",
      markdownContent: "Download the exercise file.",
      resources: [
        {
          url: "https://piccalil.li/downloads/type-playground.penpot",
          filename: "type-playground.penpot",
        },
      ],
      video: {
        embedUrl: "https://iframe.mediadelivery.net/embed/414004/video-id",
        hlsUrl: "https://vz-example.b-cdn.net/video-id/playlist.m3u8",
        referer: "https://piccalil.li/mindful-design/lessons/59",
      },
    };

    expect(formatPiccalilliMarkdown(content)).toBe(
      "# Playing With Type Scales\n\n" +
        "> Video: https://iframe.mediadelivery.net/embed/414004/video-id\n\n" +
        "Download the exercise file.\n"
    );
  });

  it("rewrites absolute and root-relative download links for offline use", () => {
    const markdown =
      "[Absolute](https://piccalil.li/downloads/file.penpot) and " +
      "[relative](/downloads/file.penpot)";
    expect(
      rewritePiccalilliResourceLinks(markdown, [
        {
          url: "https://piccalil.li/downloads/file.penpot",
          localFilename: "01-lesson-file.penpot",
        },
      ])
    ).toBe("[Absolute](./01-lesson-file.penpot) and [relative](./01-lesson-file.penpot)");
  });

  it("links to the adjacent downloaded video when a local filename is provided", () => {
    const content: PiccalilliLessonContent = {
      title: "Welcome",
      htmlContent: "",
      markdownContent: "",
      resources: [],
      video: {
        embedUrl: "https://iframe.mediadelivery.net/embed/414004/video-id",
        hlsUrl: "https://cdn.example.com/playlist.m3u8",
        referer: "https://piccalil.li/course/lessons/1",
      },
    };

    expect(formatPiccalilliMarkdown(content, "01-welcome.mp4")).toContain(
      "> Video: [Open downloaded video](./01-welcome.mp4)"
    );
  });
});
