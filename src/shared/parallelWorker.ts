import type { BrowserContext, Page } from "playwright";

/**
 * Options for parallel worker processing.
 */
export interface ParallelWorkerOptions {
  /** Number of parallel workers (browser tabs) to use */
  concurrency: number;
  /** Optional: Check if processing should stop early (e.g., shutdown signal) */
  shouldContinue?: () => boolean;
  /** Optional: Called when a worker encounters an error */
  onError?: (error: unknown, taskIndex: number) => void;
}

/**
 * Result of parallel processing.
 */
export interface ParallelWorkerResult<T> {
  results: T[];
  errors: { index: number; error: unknown }[];
}

/**
 * Processes tasks in parallel using multiple browser tabs.
 *
 * This utility abstracts the common pattern of:
 * 1. Creating worker pages (browser tabs)
 * 2. Processing a queue of tasks across workers
 * 3. Collecting results in order
 * 4. Cleaning up worker pages
 *
 * @param context - Browser context to create worker pages in
 * @param mainPage - Main page (used as fallback if tab creation fails)
 * @param tasks - Array of tasks to process
 * @param processor - Function that processes a single task using a page
 * @param options - Parallel processing options
 * @returns Results in the same order as input tasks
 *
 * @example
 * ```typescript
 * const results = await parallelProcess(
 *   context,
 *   mainPage,
 *   modules,
 *   async (page, module, index) => {
 *     await page.goto(module.url);
 *     return extractLessons(page);
 *   },
 *   { concurrency: 4 }
 * );
 * ```
 */
export async function parallelProcess<TTask, TResult>(
  context: BrowserContext,
  mainPage: Page,
  tasks: TTask[],
  processor: (page: Page, task: TTask, index: number) => Promise<TResult>,
  options: ParallelWorkerOptions
): Promise<ParallelWorkerResult<TResult>> {
  const { concurrency, shouldContinue = () => true, onError } = options;

  // Create worker pages
  const workerPages: Page[] = [];
  try {
    for (let i = 0; i < concurrency; i++) {
      const page = await context.newPage();
      workerPages.push(page);
    }
  } catch {
    // Fallback: use the main page only if tab creation fails
    if (workerPages.length === 0) {
      workerPages.push(mainPage);
    }
  }

  // Results array (maintains order)
  const results: (TResult | undefined)[] = new Array(tasks.length);
  const errors: { index: number; error: unknown }[] = [];

  // Task queue with indices
  const taskQueue: { task: TTask; index: number }[] = tasks.map((task, index) => ({
    task,
    index,
  }));

  // Worker function
  const runWorker = async (page: Page): Promise<void> => {
    while (shouldContinue() && taskQueue.length > 0) {
      const item = taskQueue.shift();
      if (!item) break;

      try {
        const result = await processor(page, item.task, item.index);
        results[item.index] = result;
      } catch (error) {
        errors.push({ index: item.index, error });
        onError?.(error, item.index);
      }
    }
  };

  // Start all workers
  const workerPromises = workerPages.map((page) => runWorker(page));
  await Promise.all(workerPromises);

  // Close worker pages (except main page)
  for (const page of workerPages) {
    if (page !== mainPage) {
      try {
        await page.close();
      } catch {
        // Ignore close errors
      }
    }
  }

  // Filter out undefined results (from failed tasks)
  const finalResults = results.filter((r): r is TResult => r !== undefined);

  return { results: finalResults, errors };
}

/**
 * Simplified version that takes an existing array of worker pages.
 * Useful when you want to reuse pages across multiple operations.
 */
export async function parallelProcessWithPages<TTask, TResult>(
  workerPages: Page[],
  tasks: TTask[],
  processor: (page: Page, task: TTask, index: number) => Promise<TResult>,
  options: Omit<ParallelWorkerOptions, "concurrency">
): Promise<ParallelWorkerResult<TResult>> {
  const { shouldContinue = () => true, onError } = options;

  // Results array (maintains order)
  const results: (TResult | undefined)[] = new Array(tasks.length);
  const errors: { index: number; error: unknown }[] = [];

  // Task queue with indices
  const taskQueue: { task: TTask; index: number }[] = tasks.map((task, index) => ({
    task,
    index,
  }));

  // Worker function
  const runWorker = async (page: Page): Promise<void> => {
    while (shouldContinue() && taskQueue.length > 0) {
      const item = taskQueue.shift();
      if (!item) break;

      try {
        const result = await processor(page, item.task, item.index);
        results[item.index] = result;
      } catch (error) {
        errors.push({ index: item.index, error });
        onError?.(error, item.index);
      }
    }
  };

  // Start all workers
  const workerPromises = workerPages.map((page) => runWorker(page));
  await Promise.all(workerPromises);

  // Filter out undefined results (from failed tasks)
  const finalResults = results.filter((r): r is TResult => r !== undefined);

  return { results: finalResults, errors };
}

/**
 * Creates a pool of worker pages for parallel processing.
 * Remember to close pages when done!
 */
export async function createWorkerPool(
  context: BrowserContext,
  mainPage: Page,
  concurrency: number
): Promise<{ pages: Page[]; isUsingMainPage: boolean }> {
  const pages: Page[] = [];

  try {
    for (let i = 0; i < concurrency; i++) {
      const page = await context.newPage();
      pages.push(page);
    }
    return { pages, isUsingMainPage: false };
  } catch {
    // Fallback to main page
    return { pages: [mainPage], isUsingMainPage: true };
  }
}

/**
 * Closes worker pages (skips main page if provided).
 */
export async function closeWorkerPool(pages: Page[], mainPage?: Page): Promise<void> {
  for (const page of pages) {
    if (page !== mainPage) {
      try {
        await page.close();
      } catch {
        // Ignore close errors
      }
    }
  }
}
