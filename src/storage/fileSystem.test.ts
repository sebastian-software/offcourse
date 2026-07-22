import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  downloadFile,
  getLessonBasename,
  getVideoPath,
  getMarkdownPath,
  getDownloadFilePath,
  isLessonSynced,
} from "./fileSystem.js";
import { http } from "../shared/http.js";
import { pathExists } from "../shared/fs.js";

/** Normalize path to POSIX format for cross-platform test assertions */
const toPosix = (p: string) => p.replace(/\\/g, "/");

describe("fileSystem", () => {
  const tempDirectories: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
    );
  });

  describe("downloadFile", () => {
    it("publishes the attachment only after the download completes", async () => {
      const directory = await mkdtemp(join(tmpdir(), "offcourse-files-"));
      tempDirectories.push(directory);
      const outputPath = join(directory, "attachment.pdf");
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("complete"));
          controller.close();
        },
      });
      vi.spyOn(http, "get").mockResolvedValue(new Response(body));

      await expect(downloadFile("https://example.com/attachment.pdf", outputPath)).resolves.toEqual(
        {
          success: true,
        }
      );
      await expect(readFile(outputPath, "utf8")).resolves.toBe("complete");
      await expect(pathExists(`${outputPath}.tmp`)).resolves.toBe(false);
    });

    it("removes an incomplete temporary attachment after a stream failure", async () => {
      const directory = await mkdtemp(join(tmpdir(), "offcourse-files-"));
      tempDirectories.push(directory);
      const outputPath = join(directory, "attachment.pdf");
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("partial"));
          controller.error(new Error("stream failed"));
        },
      });
      vi.spyOn(http, "get").mockResolvedValue(new Response(body));

      const result = await downloadFile("https://example.com/attachment.pdf", outputPath);

      expect(result.success).toBe(false);
      await expect(pathExists(outputPath)).resolves.toBe(false);
      await expect(pathExists(`${outputPath}.tmp`)).resolves.toBe(false);
    });
  });

  describe("getLessonBasename", () => {
    it("creates numbered filename from lesson name", () => {
      expect(getLessonBasename(0, "Introduction")).toBe("01-introduction");
      expect(getLessonBasename(9, "Final Lesson")).toBe("10-final-lesson");
      expect(getLessonBasename(99, "Bonus")).toBe("100-bonus");
    });

    it("handles special characters", () => {
      expect(getLessonBasename(0, "What's Next?")).toBe("01-whats-next");
      expect(getLessonBasename(0, "Module 1: Basics")).toBe("01-module-1-basics");
    });
  });

  describe("getVideoPath", () => {
    it("creates video path with .mp4 extension", () => {
      const path = getVideoPath("/courses/my-course/01-intro", 0, "Welcome");
      expect(toPosix(path)).toBe("/courses/my-course/01-intro/01-welcome.mp4");
    });

    it("handles nested paths", () => {
      const path = getVideoPath("/home/user/Downloads/courses/test", 5, "Lesson Six");
      expect(toPosix(path)).toBe("/home/user/Downloads/courses/test/06-lesson-six.mp4");
    });
  });

  describe("getMarkdownPath", () => {
    it("creates markdown path with .md extension", () => {
      const path = getMarkdownPath("/courses/my-course/01-intro", 0, "Welcome");
      expect(toPosix(path)).toBe("/courses/my-course/01-intro/01-welcome.md");
    });
  });

  describe("getDownloadFilePath", () => {
    it("prefixes filename with lesson basename", () => {
      const path = getDownloadFilePath("/module", 2, "Resources", "workbook.pdf");
      expect(toPosix(path)).toBe("/module/03-resources-workbook.pdf");
    });

    it("sanitizes dangerous filename characters", () => {
      // Characters that are invalid in filenames on various OS
      const path = getDownloadFilePath("/module", 0, "Intro", 'file<>:"/\\|?*.pdf');
      expect(toPosix(path)).toBe("/module/01-intro-file_________.pdf");
    });

    it("keeps path traversal filenames inside the module directory", () => {
      const path = getDownloadFilePath("/module", 0, "Intro", "../../secrets.txt");

      expect(toPosix(path)).toBe("/module/01-intro-.._.._secrets.txt");
    });

    it("preserves safe special characters", () => {
      const path = getDownloadFilePath("/module", 0, "Intro", "my-file_v2 (1).pdf");
      expect(toPosix(path)).toBe("/module/01-intro-my-file_v2 (1).pdf");
    });

    it("handles filenames with multiple extensions", () => {
      const path = getDownloadFilePath("/module", 0, "Intro", "archive.tar.gz");
      expect(toPosix(path)).toBe("/module/01-intro-archive.tar.gz");
    });
  });

  describe("isLessonSynced", () => {
    it("recognizes an existing lesson after its position changes", async () => {
      const directory = await mkdtemp(join(tmpdir(), "offcourse-files-"));
      tempDirectories.push(directory);
      await writeFile(join(directory, "01-welcome.mp4"), "video");
      await writeFile(join(directory, "01-welcome.md"), "content");

      await expect(isLessonSynced(directory, 4, "Welcome")).resolves.toEqual({
        video: true,
        content: true,
      });
    });

    it("does not guess when truncated lesson slugs are ambiguous", async () => {
      const directory = await mkdtemp(join(tmpdir(), "offcourse-files-"));
      tempDirectories.push(directory);
      const longName = "A".repeat(110);
      const slug = "a".repeat(100);
      await writeFile(join(directory, `01-${slug}.mp4`), "video");
      await writeFile(join(directory, `02-${slug}.mp4`), "video");

      await expect(isLessonSynced(directory, 4, longName)).resolves.toMatchObject({
        video: false,
      });
    });

    it("does not confuse a lesson name with the suffix of another lesson", async () => {
      const directory = await mkdtemp(join(tmpdir(), "offcourse-files-"));
      tempDirectories.push(directory);
      await writeFile(join(directory, "01-flow-layout.mp4"), "video");

      await expect(isLessonSynced(directory, 1, "Layout")).resolves.toMatchObject({
        video: false,
      });
    });

    it("does not use the fallback when a lesson name has an empty slug", async () => {
      const directory = await mkdtemp(join(tmpdir(), "offcourse-files-"));
      tempDirectories.push(directory);
      await writeFile(join(directory, "01-.mp4"), "video");

      await expect(isLessonSynced(directory, 1, "---")).resolves.toEqual({
        video: false,
        content: false,
      });
    });
  });
});
