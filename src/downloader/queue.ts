import PQueue from "p-queue";

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
 * An async queue for processing items with concurrency control.
 * Uses p-queue internally for battle-tested concurrency handling.
 */
export class AsyncQueue<T> {
  private items: QueueItem<T>[] = [];
  private readonly queue: PQueue;
  private readonly maxRetries: number;
  private readonly onProgress:
    | ((completed: number, total: number, current?: string) => void)
    | undefined;

  constructor(options: QueueOptions) {
    this.queue = new PQueue({ concurrency: options.concurrency });
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
  addAll(items: { id: string; data: T }[]): void {
    for (const item of items) {
      this.add(item.id, item.data);
    }
  }

  /**
   * Processes all items in the queue using the provided handler.
   */
  async process(
    handler: (item: T, id: string) => Promise<void>
  ): Promise<{ completed: number; failed: number; errors: { id: string; error: string }[] }> {
    const errors: { id: string; error: string }[] = [];

    const processItem = async (item: QueueItem<T>): Promise<void> => {
      item.status = "processing";

      // maxRetries=0 means try once, maxRetries=3 means try up to 3 times total
      const maxAttempts = Math.max(1, this.maxRetries);

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          await handler(item.data, item.id);
          item.status = "completed";
          this.reportProgress();
          return;
        } catch (error) {
          item.retries = attempt + 1;
          if (attempt >= maxAttempts - 1) {
            item.status = "failed";
            item.error = error instanceof Error ? error.message : String(error);
            errors.push({ id: item.id, error: item.error });
            this.reportProgress();
          }
        }
      }
    };

    // Add all items to the p-queue
    await this.queue.addAll(this.items.map((item) => () => processItem(item)));

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
