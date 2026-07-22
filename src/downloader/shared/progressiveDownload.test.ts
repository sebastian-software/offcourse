import { createWriteStream, existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadFile, downloadProgressiveVideo } from "./progressiveDownload.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    createWriteStream: vi.fn(actual.createWriteStream),
  };
});

const createdPaths: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    createdPaths.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe("downloadFile", () => {
  it("writes the complete response through a temporary file", async () => {
    const root = await mkdtemp(join(tmpdir(), "offcourse-progressive-"));
    createdPaths.push(root);
    const outputPath = join(root, "video.mp4");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("video-data", { status: 200 }))
    );

    const result = await downloadFile("https://cdn.example.com/video.mp4", outputPath);

    expect(result).toEqual({ success: true, outputPath });
    expect(await readFile(outputPath, "utf8")).toBe("video-data");
    expect(existsSync(`${outputPath}.tmp`)).toBe(false);
  });

  it("returns a failure and removes the temporary file when the response stream errors", async () => {
    const root = await mkdtemp(join(tmpdir(), "offcourse-progressive-"));
    createdPaths.push(root);
    const outputPath = join(root, "video.mp4");
    let readCount = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (readCount++ === 0) {
          controller.enqueue(new TextEncoder().encode("partial-data"));
        } else {
          controller.error(new Error("response stream failed"));
        }
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 200 }))
    );

    const result = await downloadFile("https://cdn.example.com/video.mp4", outputPath);

    expect(result).toMatchObject({
      success: false,
      error: "response stream failed",
      errorCode: "DOWNLOAD_FAILED",
    });
    expect(existsSync(outputPath)).toBe(false);
    expect(existsSync(`${outputPath}.tmp`)).toBe(false);
  }, 1000);
});

describe("downloadProgressiveVideo", () => {
  it("streams the complete response through a temporary file with progress", async () => {
    const root = await mkdtemp(join(tmpdir(), "offcourse-progressive-video-"));
    createdPaths.push(root);
    const outputPath = join(root, "nested", "video.mp4");
    const onProgress = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("video-data", {
            status: 200,
            headers: { "content-length": String(Buffer.byteLength("video-data")) },
          })
      )
    );

    const result = await downloadProgressiveVideo("https://cdn.example.com/video.mp4", outputPath, {
      onProgress,
    });

    expect(result).toEqual({ success: true, outputPath });
    expect(await readFile(outputPath, "utf8")).toBe("video-data");
    expect(existsSync(`${outputPath}.tmp`)).toBe(false);
    expect(onProgress).toHaveBeenLastCalledWith({ percent: 100, phase: "complete" });
  });

  it("returns a failure instead of crashing when the output stream errors", async () => {
    const root = await mkdtemp(join(tmpdir(), "offcourse-progressive-video-"));
    createdPaths.push(root);
    const outputPath = join(root, "video.mp4");
    const failingStream = new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error("disk full"));
      },
    });
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("video-data"));
      },
      cancel,
    });
    vi.mocked(createWriteStream).mockReturnValueOnce(
      failingStream as unknown as ReturnType<typeof createWriteStream>
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 200 }))
    );

    const result = await downloadProgressiveVideo("https://cdn.example.com/video.mp4", outputPath);

    expect(result).toEqual({
      success: false,
      error: "disk full",
      errorCode: "DOWNLOAD_FAILED",
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(existsSync(outputPath)).toBe(false);
    expect(existsSync(`${outputPath}.tmp`)).toBe(false);
  });

  it("removes partial output when the response stream errors", async () => {
    const root = await mkdtemp(join(tmpdir(), "offcourse-progressive-video-"));
    createdPaths.push(root);
    const outputPath = join(root, "video.mp4");
    let readCount = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (readCount++ === 0) {
          controller.enqueue(new TextEncoder().encode("partial-data"));
        } else {
          controller.error(new Error("response stream failed"));
        }
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 200 }))
    );

    const result = await downloadProgressiveVideo("https://cdn.example.com/video.mp4", outputPath);

    expect(result).toEqual({
      success: false,
      error: "response stream failed",
      errorCode: "DOWNLOAD_FAILED",
    });
    expect(existsSync(outputPath)).toBe(false);
    expect(existsSync(`${outputPath}.tmp`)).toBe(false);
  });

  it("fails a download when the response body stops producing chunks", async () => {
    const root = await mkdtemp(join(tmpdir(), "offcourse-progressive-stalled-"));
    createdPaths.push(root);
    const outputPath = join(root, "video.mp4");
    const body = new ReadableStream<Uint8Array>({
      pull() {
        return new Promise(() => undefined);
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 200 }))
    );

    const result = await downloadProgressiveVideo("https://cdn.example.com/video.mp4", outputPath, {
      inactivityTimeoutMs: 5,
    });

    expect(result).toEqual({
      success: false,
      error: "Download stalled for 5ms",
      errorCode: "DOWNLOAD_FAILED",
    });
    expect(existsSync(`${outputPath}.tmp`)).toBe(false);
  }, 1000);
});
