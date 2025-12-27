import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getLessonBasename,
  getVideoPath,
  getMarkdownPath,
  getDownloadFilePath,
} from "./fileSystem.js";

describe("fileSystem", () => {
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
      expect(path).toBe(join("/courses/my-course/01-intro", "01-welcome.mp4"));
    });

    it("handles nested paths", () => {
      const path = getVideoPath("/home/user/Downloads/courses/test", 5, "Lesson Six");
      expect(path).toBe(join("/home/user/Downloads/courses/test", "06-lesson-six.mp4"));
    });
  });

  describe("getMarkdownPath", () => {
    it("creates markdown path with .md extension", () => {
      const path = getMarkdownPath("/courses/my-course/01-intro", 0, "Welcome");
      expect(path).toBe(join("/courses/my-course/01-intro", "01-welcome.md"));
    });
  });

  describe("getDownloadFilePath", () => {
    it("prefixes filename with lesson basename", () => {
      const path = getDownloadFilePath("/module", 2, "Resources", "workbook.pdf");
      expect(path).toBe(join("/module", "03-resources-workbook.pdf"));
    });

    it("sanitizes dangerous filename characters", () => {
      // Characters that are invalid in filenames on various OS
      const path = getDownloadFilePath("/module", 0, "Intro", 'file<>:"/\\|?*.pdf');
      expect(path).toBe(join("/module", "01-intro-file_________.pdf"));
    });

    it("preserves safe special characters", () => {
      const path = getDownloadFilePath("/module", 0, "Intro", "my-file_v2 (1).pdf");
      expect(path).toBe(join("/module", "01-intro-my-file_v2 (1).pdf"));
    });

    it("handles filenames with multiple extensions", () => {
      const path = getDownloadFilePath("/module", 0, "Intro", "archive.tar.gz");
      expect(path).toBe(join("/module", "01-intro-archive.tar.gz"));
    });
  });
});
