import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadFile } from "./progressiveDownload.js";

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
