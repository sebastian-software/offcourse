import { describe, expect, it, vi } from "vitest";
import { AsyncQueue } from "./queue.js";

describe("AsyncQueue", () => {
  it("processes items in order", async () => {
    const processed: string[] = [];
    const queue = new AsyncQueue<string>({
      concurrency: 1,
      maxRetries: 0,
    });

    queue.add("1", "first");
    queue.add("2", "second");
    queue.add("3", "third");

    await queue.process(async (item) => {
      processed.push(item);
    });

    expect(processed).toEqual(["first", "second", "third"]);
  });

  it("tracks completed and failed counts", async () => {
    const queue = new AsyncQueue<string>({
      concurrency: 1,
      maxRetries: 0,
    });

    queue.add("1", "success");
    queue.add("2", "fail");
    queue.add("3", "success");

    const result = await queue.process(async (item) => {
      if (item === "fail") {
        throw new Error("Intentional failure");
      }
    });

    expect(result.completed).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.id).toBe("2");
  });

  it("retries failed items up to maxRetries", async () => {
    let attempts = 0;
    const queue = new AsyncQueue<string>({
      concurrency: 1,
      maxRetries: 3,
    });

    queue.add("1", "retry-test");

    await queue.process(async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error("Not yet");
      }
    });

    expect(attempts).toBe(3);
  });

  it("adds multiple items with addAll", async () => {
    const queue = new AsyncQueue<number>({
      concurrency: 1,
      maxRetries: 0,
    });

    queue.addAll([
      { id: "a", data: 1 },
      { id: "b", data: 2 },
      { id: "c", data: 3 },
    ]);

    const sum = { value: 0 };
    await queue.process(async (item) => {
      sum.value += item;
    });

    expect(sum.value).toBe(6);
  });

  it("reports progress during processing", async () => {
    const progressCalls: Array<{ completed: number; total: number }> = [];

    const queue = new AsyncQueue<string>({
      concurrency: 1,
      maxRetries: 0,
      onProgress: (completed, total) => {
        progressCalls.push({ completed, total });
      },
    });

    queue.add("1", "a");
    queue.add("2", "b");
    queue.add("3", "c");

    await queue.process(async () => {
      // no-op
    });

    expect(progressCalls.length).toBeGreaterThan(0);
    // Last call should have all completed
    const lastCall = progressCalls.at(-1);
    expect(lastCall?.completed).toBe(3);
    expect(lastCall?.total).toBe(3);
  });

  it("returns correct status", async () => {
    const queue = new AsyncQueue<string>({
      concurrency: 1,
      maxRetries: 0,
    });

    queue.add("1", "a");
    queue.add("2", "b");

    const beforeStatus = queue.getStatus();
    expect(beforeStatus.pending).toBe(2);
    expect(beforeStatus.completed).toBe(0);

    await queue.process(async () => {});

    const afterStatus = queue.getStatus();
    expect(afterStatus.pending).toBe(0);
    expect(afterStatus.completed).toBe(2);
  });

  it("handles concurrent processing", async () => {
    const processing: Set<string> = new Set();
    let maxConcurrent = 0;

    const queue = new AsyncQueue<string>({
      concurrency: 2,
      maxRetries: 0,
    });

    queue.addAll([
      { id: "1", data: "a" },
      { id: "2", data: "b" },
      { id: "3", data: "c" },
      { id: "4", data: "d" },
    ]);

    await queue.process(async (item, id) => {
      processing.add(id);
      maxConcurrent = Math.max(maxConcurrent, processing.size);
      // Simulate async work
      await new Promise((r) => setTimeout(r, 10));
      processing.delete(id);
    });

    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it("handles empty queue", async () => {
    const queue = new AsyncQueue<string>({
      concurrency: 1,
      maxRetries: 0,
    });

    const result = await queue.process(async () => {});

    expect(result.completed).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it("captures error messages correctly", async () => {
    const queue = new AsyncQueue<string>({
      concurrency: 1,
      maxRetries: 0,
    });

    queue.add("1", "test");

    const result = await queue.process(async () => {
      throw new Error("Specific error message");
    });

    expect(result.errors[0]?.error).toBe("Specific error message");
  });

  it("handles non-Error throws", async () => {
    const queue = new AsyncQueue<string>({
      concurrency: 1,
      maxRetries: 0,
    });

    queue.add("1", "test");

    const result = await queue.process(async () => {
      throw "String error";
    });

    expect(result.errors[0]?.error).toBe("String error");
  });
});

