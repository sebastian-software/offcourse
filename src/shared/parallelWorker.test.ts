import { describe, expect, it, vi } from "vitest";
import type { BrowserContext, Page } from "playwright";
import {
  parallelProcess,
  parallelProcessWithPages,
  createWorkerPool,
  closeWorkerPool,
} from "./parallelWorker.js";

/**
 * Creates a mock Playwright Page with tracked close function.
 */
function createMockPage(id: string): { page: Page; closeFn: ReturnType<typeof vi.fn> } {
  const closeFn = vi.fn().mockResolvedValue(undefined);
  const page = {
    id,
    close: closeFn,
    goto: vi.fn().mockResolvedValue(undefined),
  } as unknown as Page;
  return { page, closeFn };
}

/**
 * Creates a mock BrowserContext that can create pages.
 */
function createMockContext(pagesToCreate: Page[]): {
  context: BrowserContext;
  newPageFn: ReturnType<typeof vi.fn>;
} {
  let pageIndex = 0;
  const newPageFn = vi.fn().mockImplementation(() => {
    if (pageIndex < pagesToCreate.length) {
      return Promise.resolve(pagesToCreate[pageIndex++]);
    }
    throw new Error("Cannot create more pages");
  });
  const context = { newPage: newPageFn } as unknown as BrowserContext;
  return { context, newPageFn };
}

describe("parallelWorker", () => {
  describe("createWorkerPool", () => {
    it("creates the requested number of worker pages", async () => {
      const mocks = [createMockPage("1"), createMockPage("2"), createMockPage("3")];
      const pages = mocks.map((m) => m.page);
      const { context, newPageFn } = createMockContext(pages);
      const { page: mainPage } = createMockPage("main");

      const result = await createWorkerPool(context, mainPage, 3);

      expect(result.pages).toHaveLength(3);
      expect(result.isUsingMainPage).toBe(false);
      expect(newPageFn).toHaveBeenCalledTimes(3);
    });

    it("falls back to main page if page creation fails", async () => {
      const newPageFn = vi.fn().mockRejectedValue(new Error("Cannot create page"));
      const context = { newPage: newPageFn } as unknown as BrowserContext;
      const { page: mainPage } = createMockPage("main");

      const result = await createWorkerPool(context, mainPage, 3);

      expect(result.pages).toHaveLength(1);
      expect(result.pages[0]).toBe(mainPage);
      expect(result.isUsingMainPage).toBe(true);
    });
  });

  describe("closeWorkerPool", () => {
    it("closes all pages except the main page", async () => {
      const mock1 = createMockPage("1");
      const mock2 = createMockPage("2");
      const mockMain = createMockPage("main");
      const pages = [mock1.page, mock2.page, mockMain.page];

      await closeWorkerPool(pages, mockMain.page);

      expect(mock1.closeFn).toHaveBeenCalled();
      expect(mock2.closeFn).toHaveBeenCalled();
      expect(mockMain.closeFn).not.toHaveBeenCalled();
    });

    it("closes all pages when no main page is provided", async () => {
      const mock1 = createMockPage("1");
      const mock2 = createMockPage("2");
      const pages = [mock1.page, mock2.page];

      await closeWorkerPool(pages);

      expect(mock1.closeFn).toHaveBeenCalled();
      expect(mock2.closeFn).toHaveBeenCalled();
    });

    it("ignores close errors", async () => {
      const closeFn = vi.fn().mockRejectedValue(new Error("Close failed"));
      const page = { close: closeFn } as unknown as Page;

      // Should not throw
      await expect(closeWorkerPool([page])).resolves.toBeUndefined();
    });
  });

  describe("parallelProcessWithPages", () => {
    it("processes all tasks using worker pages", async () => {
      const pages = [createMockPage("1").page, createMockPage("2").page];
      const tasks = ["task1", "task2", "task3", "task4"];
      const processor = vi.fn(
        async (_page: Page, task: string): Promise<string> => `result-${task}`
      );

      const result = await parallelProcessWithPages(pages, tasks, processor, {});

      expect(result.results).toHaveLength(4);
      expect(result.results).toContain("result-task1");
      expect(result.results).toContain("result-task2");
      expect(result.results).toContain("result-task3");
      expect(result.results).toContain("result-task4");
      expect(result.errors).toHaveLength(0);
    });

    it("maintains result order regardless of completion order", async () => {
      const pages = [createMockPage("1").page];
      const tasks = [1, 2, 3];
      const processor = vi.fn(
        async (_page: Page, task: number): Promise<string> => `result-${task}`
      );

      const result = await parallelProcessWithPages(pages, tasks, processor, {});

      // Results should be in order of task indices, not completion order
      expect(result.results[0]).toBe("result-1");
      expect(result.results[1]).toBe("result-2");
      expect(result.results[2]).toBe("result-3");
    });

    it("collects errors with task indices", async () => {
      const pages = [createMockPage("1").page];
      const tasks = ["good", "bad", "good2"];
      const processor = vi.fn(async (_page: Page, task: string): Promise<string> => {
        if (task === "bad") {
          throw new Error("Task failed");
        }
        return `result-${task}`;
      });

      const result = await parallelProcessWithPages(pages, tasks, processor, {});

      expect(result.results).toHaveLength(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.index).toBe(1);
      expect(result.errors[0]!.error).toBeInstanceOf(Error);
    });

    it("calls onError callback when a task fails", async () => {
      const pages = [createMockPage("1").page];
      const tasks = ["fail"];
      const onError = vi.fn();
      const processor = vi.fn().mockRejectedValue(new Error("Boom"));

      await parallelProcessWithPages(pages, tasks, processor, { onError });

      expect(onError).toHaveBeenCalledWith(expect.any(Error), 0);
    });

    it("respects shouldContinue and stops early", async () => {
      const pages = [createMockPage("1").page];
      const tasks = [1, 2, 3, 4, 5];
      let processedCount = 0;

      const processor = vi.fn(async (_page: Page, task: number): Promise<number> => {
        processedCount++;
        return task;
      });

      // Stop after processing 2 tasks
      let callCount = 0;
      const shouldContinue = () => {
        callCount++;
        return callCount <= 2;
      };

      await parallelProcessWithPages(pages, tasks, processor, {
        shouldContinue,
      });

      // Should have processed approximately 2 tasks (depends on timing)
      expect(processedCount).toBeLessThan(tasks.length);
    });

    it("handles empty task list", async () => {
      const pages = [createMockPage("1").page];
      const processor = vi.fn();

      const result = await parallelProcessWithPages(pages, [], processor, {});

      expect(result.results).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
      expect(processor).not.toHaveBeenCalled();
    });

    it("passes page, task, and index to processor", async () => {
      const { page } = createMockPage("1");
      const pages = [page];
      const tasks = ["a", "b"];
      const processor = vi.fn(async (_page: Page, _task: string): Promise<string> => "done");

      await parallelProcessWithPages(pages, tasks, processor, {});

      expect(processor).toHaveBeenCalledWith(page, "a", 0);
      expect(processor).toHaveBeenCalledWith(page, "b", 1);
    });
  });

  describe("parallelProcess", () => {
    it("creates worker pages and processes tasks", async () => {
      const mock1 = createMockPage("1");
      const mock2 = createMockPage("2");
      const workerPages = [mock1.page, mock2.page];
      const { context, newPageFn } = createMockContext(workerPages);
      const { page: mainPage } = createMockPage("main");
      const tasks = ["t1", "t2"];
      const processor = vi.fn(async (_page: Page, task: string): Promise<string> => `r-${task}`);

      const result = await parallelProcess(context, mainPage, tasks, processor, {
        concurrency: 2,
      });

      expect(result.results).toHaveLength(2);
      expect(newPageFn).toHaveBeenCalledTimes(2);
    });

    it("closes worker pages after processing", async () => {
      const mock1 = createMockPage("1");
      const workerPages = [mock1.page];
      const { context } = createMockContext(workerPages);
      const { page: mainPage } = createMockPage("main");
      const processor = vi.fn(async (_page: Page, _task: string): Promise<string> => "done");

      await parallelProcess(context, mainPage, ["task"], processor, {
        concurrency: 1,
      });

      expect(mock1.closeFn).toHaveBeenCalled();
    });

    it("falls back to main page if tab creation fails", async () => {
      const newPageFn = vi.fn().mockRejectedValue(new Error("No tabs"));
      const context = { newPage: newPageFn } as unknown as BrowserContext;
      const { page: mainPage, closeFn: mainCloseFn } = createMockPage("main");
      const processor = vi.fn(async (_page: Page, _task: string): Promise<string> => "done");

      const result = await parallelProcess(context, mainPage, ["task"], processor, {
        concurrency: 2,
      });

      expect(result.results).toHaveLength(1);
      // Main page should not be closed
      expect(mainCloseFn).not.toHaveBeenCalled();
    });
  });
});
