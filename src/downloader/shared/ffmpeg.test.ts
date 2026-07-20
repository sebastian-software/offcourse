import { EventEmitter } from "node:events";
import { existsSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { afterEach, describe, expect, it, vi } from "vitest";
import { concatSegments, downloadWithFfmpeg, mergeVideoAudio } from "./ffmpeg.js";

vi.mock("execa");

const createdPaths: string[] = [];
const execaMock = vi.mocked(execa);

function mockSubprocess(result: "success" | "failure") {
  execaMock.mockImplementation((_command, args) => {
    const outputPath = Array.isArray(args) ? args[args.length - 1] : undefined;
    if (typeof outputPath === "string") writeFileSync(outputPath, "ffmpeg-output");
    const promise =
      result === "success" ? Promise.resolve({}) : Promise.reject(new Error("ffmpeg failed"));
    return Object.assign(promise, { stderr: new EventEmitter() }) as ReturnType<typeof execa>;
  });
}

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(
    createdPaths.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe("ffmpeg output publishing", () => {
  it("publishes a completed HLS download from a temporary file", async () => {
    const root = await mkdtemp(join(tmpdir(), "offcourse-ffmpeg-"));
    createdPaths.push(root);
    const outputPath = join(root, "video.mp4");
    mockSubprocess("success");

    const result = await downloadWithFfmpeg("https://cdn.example.com/video.m3u8", outputPath);

    expect(result.success).toBe(true);
    expect(await readFile(outputPath, "utf8")).toBe("ffmpeg-output");
    expect(existsSync(`${outputPath}.tmp`)).toBe(false);
    expect(execaMock.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining(["-f", "mp4", `${outputPath}.tmp`])
    );
  });

  it("removes a partial HLS download without publishing it", async () => {
    const root = await mkdtemp(join(tmpdir(), "offcourse-ffmpeg-"));
    createdPaths.push(root);
    const outputPath = join(root, "video.mp4");
    mockSubprocess("failure");

    const result = await downloadWithFfmpeg("https://cdn.example.com/video.m3u8", outputPath);

    expect(result.success).toBe(false);
    expect(existsSync(outputPath)).toBe(false);
    expect(existsSync(`${outputPath}.tmp`)).toBe(false);
  });

  it("prevents credential values from injecting ffmpeg headers", async () => {
    const root = await mkdtemp(join(tmpdir(), "offcourse-ffmpeg-"));
    createdPaths.push(root);
    const outputPath = join(root, "video.mp4");
    mockSubprocess("success");

    await downloadWithFfmpeg("https://cdn.example.com/video.m3u8", outputPath, {
      cookies: "session=abc\r\nX-Evil: yes",
      authToken: "secret\nInjected",
    });

    const args = execaMock.mock.calls[0]?.[1] as string[];
    const headers = args[args.indexOf("-headers") + 1];
    expect(headers).toContain("Cookie: session=abcX-Evil: yes");
    expect(headers).toContain("Authorization: Bearer secretInjected");
    expect(headers).not.toContain("\r\nX-Evil: yes");
  });

  it("publishes concatenated segments only after ffmpeg succeeds", async () => {
    const root = await mkdtemp(join(tmpdir(), "offcourse ffmpeg O'Brien-"));
    createdPaths.push(root);
    const outputPath = join(root, "video.mp4");
    const segmentPath = join(root, "O'Brien.ts");
    writeFileSync(segmentPath, "segment");
    mockSubprocess("success");

    const result = await concatSegments([segmentPath], outputPath, root);

    expect(result).toBe(true);
    expect(await readFile(outputPath, "utf8")).toBe("ffmpeg-output");
    expect(await readFile(join(root, "concat.txt"), "utf8")).toBe("file 'O'\\''Brien.ts'");
    expect(existsSync(`${outputPath}.tmp`)).toBe(false);
  });

  it("removes partial concatenated output when ffmpeg fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "offcourse-ffmpeg-"));
    createdPaths.push(root);
    const outputPath = join(root, "video.mp4");
    const segmentPath = join(root, "segment.ts");
    writeFileSync(segmentPath, "segment");
    mockSubprocess("failure");

    const result = await concatSegments([segmentPath], outputPath, root);

    expect(result).toBe(false);
    expect(existsSync(outputPath)).toBe(false);
    expect(existsSync(`${outputPath}.tmp`)).toBe(false);
  });

  it("publishes a completed video and audio merge and removes its inputs", async () => {
    const root = await mkdtemp(join(tmpdir(), "offcourse-ffmpeg-"));
    createdPaths.push(root);
    const videoPath = join(root, "video.ts");
    const audioPath = join(root, "audio.ts");
    const outputPath = join(root, "video.mp4");
    writeFileSync(videoPath, "video");
    writeFileSync(audioPath, "audio");
    mockSubprocess("success");

    const result = await mergeVideoAudio(videoPath, audioPath, outputPath);

    expect(result).toBe(true);
    expect(await readFile(outputPath, "utf8")).toBe("ffmpeg-output");
    expect(existsSync(`${outputPath}.tmp`)).toBe(false);
    expect(existsSync(videoPath)).toBe(false);
    expect(existsSync(audioPath)).toBe(false);
  });

  it("does not publish a failed video and audio merge", async () => {
    const root = await mkdtemp(join(tmpdir(), "offcourse-ffmpeg-"));
    createdPaths.push(root);
    const videoPath = join(root, "video.ts");
    const audioPath = join(root, "audio.ts");
    const outputPath = join(root, "video.mp4");
    writeFileSync(videoPath, "video");
    writeFileSync(audioPath, "audio");
    mockSubprocess("failure");

    const result = await mergeVideoAudio(videoPath, audioPath, outputPath);

    expect(result).toBe(false);
    expect(existsSync(outputPath)).toBe(false);
    expect(existsSync(`${outputPath}.tmp`)).toBe(false);
    expect(existsSync(videoPath)).toBe(false);
    expect(existsSync(audioPath)).toBe(false);
  });
});
