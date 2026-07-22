import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadSegmentsToFile } from "./hlsDownload.js";

const createdPaths: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    createdPaths.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe("downloadSegmentsToFile", () => {
  it("writes every segment in order before publishing the output", async () => {
    const root = await mkdtemp(join(tmpdir(), "offcourse-segments-"));
    createdPaths.push(root);
    const outputPath = join(root, "video.ts");
    const onProgress = vi.fn();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("segment-one", { status: 200 }))
      .mockResolvedValueOnce(new Response("segment-two", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await downloadSegmentsToFile(
      ["https://cdn.example.com/1.ts", "https://cdn.example.com/2.ts"],
      outputPath,
      { onProgress }
    );

    expect(result).toEqual({ success: true });
    expect(await readFile(outputPath, "utf8")).toBe("segment-onesegment-two");
    expect(existsSync(`${outputPath}.tmp`)).toBe(false);
    expect(onProgress.mock.calls).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it("retries a failed segment and removes partial output when retries are exhausted", async () => {
    const root = await mkdtemp(join(tmpdir(), "offcourse-segments-"));
    createdPaths.push(root);
    const outputPath = join(root, "video.ts");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("segment-one", { status: 200 }))
      .mockResolvedValue(new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await downloadSegmentsToFile(
      ["https://cdn.example.com/1.ts", "https://cdn.example.com/2.ts"],
      outputPath
    );

    expect(result).toMatchObject({ success: false });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(existsSync(outputPath)).toBe(false);
    expect(existsSync(`${outputPath}.tmp`)).toBe(false);
  });

  it("does not retry permanent client errors", async () => {
    const root = await mkdtemp(join(tmpdir(), "offcourse-segments-"));
    createdPaths.push(root);
    const outputPath = join(root, "video.ts");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("expired", { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await downloadSegmentsToFile(["https://cdn.example.com/1.ts"], outputPath);

    expect(result).toEqual({
      success: false,
      error: "Failed to download segment 0: HTTP 403",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(existsSync(outputPath)).toBe(false);
    expect(existsSync(`${outputPath}.tmp`)).toBe(false);
  });

  it("does not retry successful responses without a body", async () => {
    const root = await mkdtemp(join(tmpdir(), "offcourse-segments-"));
    createdPaths.push(root);
    const outputPath = join(root, "video.ts");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await downloadSegmentsToFile(["https://cdn.example.com/1.ts"], outputPath);

    expect(result).toEqual({
      success: false,
      error: "Failed to download segment 0: empty response body",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(existsSync(outputPath)).toBe(false);
    expect(existsSync(`${outputPath}.tmp`)).toBe(false);
  });

  it("retries the whole segment when its response stream fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "offcourse-segments-"));
    createdPaths.push(root);
    const outputPath = join(root, "video.ts");
    const failedBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("partial-data"));
        controller.error(new Error("response stream failed"));
      },
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(failedBody, { status: 200 }))
      .mockResolvedValueOnce(new Response("complete-segment", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await downloadSegmentsToFile(["https://cdn.example.com/1.ts"], outputPath);

    expect(result).toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await readFile(outputPath, "utf8")).toBe("complete-segment");
  });
});
