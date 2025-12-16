export interface QueueItem<T> {
  id: string;
  data: T;
  status: "pending" | "processing" | "completed" | "failed";
  error?: string;
  retries: number;
}

export interface QueueOptions {
  concurrency: number;
  maxRetries: number;
  onProgress?: ((completed: number, total: number, current?: string) => void) | undefined;
}

/**
 * A simple async queue for processing items with concurrency control.
 */
export class AsyncQueue<T> {
  private items: QueueItem<T>[] = [];
  private processing = 0;
  private readonly concurrency: number;
  private readonly maxRetries: number;
  private readonly onProgress: ((completed: number, total: number, current?: string) => void) | undefined;

  constructor(options: QueueOptions) {
    this.concurrency = options.concurrency;
    this.maxRetries = options.maxRetries;
    this.onProgress = options.onProgress;
  }

  /**
   * Adds an item to the queue.
   */
  add(id: string, data: T): void {
    this.items.push({
      id,
      data,
      status: "pending",
      retries: 0,
    });
  }

  /**
   * Adds multiple items to the queue.
   */
  addAll(items: Array<{ id: string; data: T }>): void {
    for (const item of items) {
      this.add(item.id, item.data);
    }
  }

  /**
   * Processes all items in the queue using the provided handler.
   */
  async process(
    handler: (item: T, id: string) => Promise<void>
  ): Promise<{ completed: number; failed: number; errors: Array<{ id: string; error: string }> }> {
    const errors: Array<{ id: string; error: string }> = [];

    const processNext = async (): Promise<void> => {
      const item = this.items.find((i) => i.status === "pending");

      if (!item) {
        return;
      }

      item.status = "processing";
      this.processing++;

      try {
        await handler(item.data, item.id);
        item.status = "completed";
      } catch (error) {
        item.retries++;

        if (item.retries < this.maxRetries) {
          item.status = "pending";
        } else {
          item.status = "failed";
          item.error = error instanceof Error ? error.message : String(error);
          errors.push({ id: item.id, error: item.error });
        }
      }

      this.processing--;
      this.reportProgress();

      // Process next item
      await processNext();
    };

    // Start initial batch of concurrent processors
    const initialBatch = Math.min(this.concurrency, this.items.length);
    const processors = Array.from({ length: initialBatch }, () => processNext());

    await Promise.all(processors);

    const completed = this.items.filter((i) => i.status === "completed").length;
    const failed = this.items.filter((i) => i.status === "failed").length;

    return { completed, failed, errors };
  }

  private reportProgress(): void {
    if (!this.onProgress) return;

    const completed = this.items.filter((i) => i.status === "completed").length;
    const total = this.items.length;
    const current = this.items.find((i) => i.status === "processing");

    this.onProgress(completed, total, current?.id);
  }

  /**
   * Gets the current queue status.
   */
  getStatus(): { pending: number; processing: number; completed: number; failed: number } {
    return {
      pending: this.items.filter((i) => i.status === "pending").length,
      processing: this.items.filter((i) => i.status === "processing").length,
      completed: this.items.filter((i) => i.status === "completed").length,
      failed: this.items.filter((i) => i.status === "failed").length,
    };
  }
}

