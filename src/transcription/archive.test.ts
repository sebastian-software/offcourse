import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configSchema } from "../config/schema.js";
import { enrichArchive } from "./archive.js";
import type { CuttledocProcessRunner } from "./cuttledoc.js";
import { transcriptOutputPaths } from "./outputs.js";

const transcript = {
  schema_version: "1.0.0",
  kind: "transcription",
  raw_text: "raw words",
  text: "Readable words.",
  language: "en",
  backend: "whisper",
  model: "test",
  media_duration_ms: 1000,
  processing_duration_ms: 500,
  enhancement: null,
};

describe("enrich local downloads", () => {
  let directory: string;
  const config = configSchema.parse({});

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "offcourse-enrich-"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  function runner() {
    return vi.fn<CuttledocProcessRunner>().mockImplementation(async (_executable, args) => ({
      stdout: args[0] === "--version" ? "cuttledoc 3.0.0\n" : JSON.stringify(transcript),
      stderr: "",
    }));
  }

  it("recursively enriches old downloads without a database and resumes without running Cuttledoc", async () => {
    const module = join(directory, "Module");
    await mkdir(module);
    const video = join(module, "Lesson.MP4");
    await writeFile(video, "video");
    await writeFile(join(module, "notes.md"), "notes");
    await writeFile(join(module, "source.ts"), "typescript source");
    await symlink(directory, join(module, "cycle"));
    const process = runner();
    expect(await enrichArchive(directory, config, { runner: process })).toMatchObject({
      discovered: 1,
      completed: 1,
      failures: [],
    });
    const paths = transcriptOutputPaths(video);
    expect(JSON.parse(await readFile(paths.jsonPath, "utf8"))).toEqual(transcript);
    expect(await readFile(paths.markdownPath, "utf8")).toBe("# Lesson\n\nReadable words.\n");
    process.mockClear();
    expect(await enrichArchive(directory, config, { runner: process })).toMatchObject({
      skipped: 1,
      completed: 0,
    });
    expect(process).not.toHaveBeenCalled();
  });

  it("restores missing markdown from JSON without a speech engine", async () => {
    const video = join(directory, "Lesson.mp4");
    await writeFile(video, "video");
    const paths = transcriptOutputPaths(video);
    await writeFile(paths.jsonPath, JSON.stringify(transcript));
    const process = runner();
    expect(await enrichArchive(directory, config, { runner: process })).toMatchObject({
      restored: 1,
    });
    expect(await readFile(paths.markdownPath, "utf8")).toContain("Readable words.");
    expect(process).not.toHaveBeenCalled();
  });

  it("preserves edited markdown while replacing invalid JSON, unless forced", async () => {
    const video = join(directory, "Lesson.mp4");
    await writeFile(video, "video");
    const paths = transcriptOutputPaths(video);
    await writeFile(paths.jsonPath, "{broken");
    await writeFile(paths.markdownPath, "My edited transcript");
    const process = runner();
    await enrichArchive(directory, config, { runner: process });
    expect(await readFile(paths.markdownPath, "utf8")).toBe("My edited transcript");
    await enrichArchive(directory, config, { runner: process, force: true });
    expect(await readFile(paths.markdownPath, "utf8")).toContain("Readable words.");
    expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("previews missing transcripts without restoring files or starting Cuttledoc", async () => {
    const video = join(directory, "Lesson.mp4");
    await writeFile(video, "video");
    await writeFile(transcriptOutputPaths(video).jsonPath, JSON.stringify(transcript));
    const before = await readdir(directory);
    const process = runner();
    expect(await enrichArchive(directory, config, { runner: process, dryRun: true })).toMatchObject(
      { pending: 1, restored: 0 }
    );
    expect(await readdir(directory)).toEqual(before);
    expect(process).not.toHaveBeenCalled();
  });

  it("continues after one video fails and retries only missing transcripts", async () => {
    for (const name of ["A.mp4", "B.mp4"]) await writeFile(join(directory, name), "video");
    const process = runner();
    process
      .mockResolvedValueOnce({ stdout: "cuttledoc 3.0.0", stderr: "" })
      .mockRejectedValueOnce({ stderr: "error[RECOGNITION_FAILED]: bad video" });
    const first = await enrichArchive(directory, config, { runner: process });
    expect(first.completed).toBe(1);
    expect(first.failures).toHaveLength(1);
    const retry = runner();
    expect(await enrichArchive(directory, config, { runner: retry })).toMatchObject({
      completed: 1,
      skipped: 1,
      failures: [],
    });
    expect(retry).toHaveBeenCalledTimes(2);
  });

  it("rejects colliding video stems before writing or starting a process", async () => {
    await writeFile(join(directory, "Lesson.mp4"), "video");
    await writeFile(join(directory, "Lesson.webm"), "video");
    const process = runner();
    await expect(enrichArchive(directory, config, { runner: process })).rejects.toThrow(
      "share a transcript filename"
    );
    expect(process).not.toHaveBeenCalled();
  });

  it("does not require Cuttledoc for an empty archive or after cancellation", async () => {
    const process = runner();
    expect(await enrichArchive(directory, config, { runner: process })).toMatchObject({
      discovered: 0,
    });
    await writeFile(join(directory, "Lesson.mp4"), "video");
    expect(
      await enrichArchive(directory, config, { runner: process, shouldContinue: () => false })
    ).toMatchObject({ pending: 1, completed: 0 });
    expect(process).not.toHaveBeenCalled();
  });

  it("reports a missing executable once without writing transcripts", async () => {
    await writeFile(join(directory, "A.mp4"), "video");
    await writeFile(join(directory, "B.mp4"), "video");
    const process = runner().mockRejectedValue({ code: "ENOENT" });
    await expect(enrichArchive(directory, config, { runner: process })).rejects.toThrow(
      "sync --no-transcribe"
    );
    expect(process).toHaveBeenCalledOnce();
    expect(await readdir(directory)).toEqual(["A.mp4", "B.mp4"]);
  });
});
