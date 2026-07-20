import { describe, expect, it, vi } from "vitest";
import type { BrowserContext, Page } from "playwright";
import {
  downloadVideoTasks,
  formatHtmlLessonMarkdown,
  runParallelSyncStage,
} from "./syncPipeline.js";
import type { VideoDownloadTask } from "../downloader/index.js";

vi.mock("cli-progress", () => {
  class SingleBar {
    start = vi.fn();
    update = vi.fn();
    stop = vi.fn();
  }

  class MultiBar {
    create = vi.fn(() => ({ update: vi.fn() }));
    remove = vi.fn();
    stop = vi.fn();
  }

  return {
    default: {
      SingleBar,
      MultiBar,
      Presets: { shades_grey: {} },
    },
  };
});

function createPage(): Page {
  return { close: vi.fn().mockResolvedValue(undefined) } as unknown as Page;
}

describe("runParallelSyncStage", () => {
  it("processes tasks and closes its worker pages", async () => {
    const closeWorker = vi.fn().mockResolvedValue(undefined);
    const worker = { close: closeWorker } as unknown as Page;
    const context = {
      newPage: vi.fn().mockResolvedValue(worker),
    } as unknown as BrowserContext;
    const mainPage = createPage();

    const result = await runParallelSyncStage({
      context,
      mainPage,
      tasks: ["one", "two"],
      concurrency: 1,
      getTaskLabel: (task) => task,
      processTask: async (_page, task) => task.toUpperCase(),
    });

    expect(result.results).toEqual(["ONE", "TWO"]);
    expect(result.errors).toEqual([]);
    expect(closeWorker).toHaveBeenCalledOnce();
  });

  it("keeps processing after a task failure", async () => {
    const context = {
      newPage: vi.fn().mockResolvedValue(createPage()),
    } as unknown as BrowserContext;
    const onError = vi.fn();

    const result = await runParallelSyncStage({
      context,
      mainPage: createPage(),
      tasks: ["good", "bad", "also-good"],
      concurrency: 1,
      getTaskLabel: (task) => task,
      processTask: async (_page, task) => {
        if (task === "bad") throw new Error("broken");
        return task;
      },
      onError,
    });

    expect(result.results).toEqual(["good", "also-good"]);
    expect(result.errors).toHaveLength(1);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 1);
  });

  it("warns when browser workers fall back to the main page", async () => {
    const context = {
      newPage: vi.fn().mockRejectedValue(new Error("Cannot create page")),
    } as unknown as BrowserContext;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await runParallelSyncStage({
      context,
      mainPage: createPage(),
      tasks: ["one"],
      concurrency: 2,
      getTaskLabel: (task) => task,
      processTask: async (_page, task) => task,
    });

    expect(result.results).toEqual(["one"]);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("falling back to sequential")
    );
    consoleError.mockRestore();
  });
});

describe("downloadVideoTasks", () => {
  const tasks: VideoDownloadTask[] = [
    {
      lessonId: 1,
      lessonName: "One",
      videoUrl: "https://example.com/one.mp4",
      videoType: "native",
      outputPath: "/tmp/one.mp4",
    },
    {
      lessonId: 2,
      lessonName: "Two",
      videoUrl: "https://example.com/two.mp4",
      videoType: "native",
      outputPath: "/tmp/two.mp4",
    },
  ];

  it("returns successful and failed outcomes in task order", async () => {
    const downloadTask = vi.fn(async (task: VideoDownloadTask) =>
      task.lessonId === 1 ? { success: true } : { success: false, error: "network failed" }
    );

    const result = await downloadVideoTasks(tasks, {
      concurrency: 2,
      downloadTask,
    });

    expect(result.completed).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.task.lessonName).toBe("Two");
    expect(result.outcomes.map((outcome) => outcome.task.lessonId)).toEqual([1, 2]);
  });

  it("honors the requested concurrency", async () => {
    let active = 0;
    let maxActive = 0;
    const downloadTask = vi.fn(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return { success: true };
    });

    await downloadVideoTasks(tasks, { concurrency: 1, downloadTask });

    expect(maxActive).toBe(1);
  });
});

describe("formatHtmlLessonMarkdown", () => {
  it("formats shared HTML lesson fields", () => {
    const result = formatHtmlLessonMarkdown({
      title: "Lesson",
      description: "Description",
      htmlContent: "<ul><li>One</li><li>Two &amp; three</li></ul>",
      videoUrl: "https://example.com/video.mp4",
    });

    expect(result).toContain("# Lesson");
    expect(result).toContain("Description");
    expect(result).toContain("Video URL: https://example.com/video.mp4");
    expect(result).toContain("- One");
    expect(result).toContain("- Two & three");
  });
});
