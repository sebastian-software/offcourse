import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configSchema } from "../config/schema.js";
import { CourseDatabase } from "../state/index.js";
import type { CuttledocProcessRunner } from "./cuttledoc.js";
import { transcribeCourseVideos, transcriptOutputPaths } from "./pipeline.js";

const versionOutput = { stdout: "cuttledoc 0.1.0\n", stderr: "" };
const transcriptionOutput = {
  stdout: JSON.stringify({
    schema_version: "1.0.0",
    kind: "transcription",
    raw_text: "raw transcript",
    text: "Corrected transcript.",
    language: "de-DE",
    backend: "apple-speech",
    model: "apple-speech-assets",
    media_duration_ms: 12_500,
    processing_duration_ms: 900,
    enhancement: null,
  }),
  stderr: "complete\t1.0\n",
};

describe("course transcription pipeline", () => {
  let directory: string;
  let database: CourseDatabase;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "offcourse-transcription-"));
    database = new CourseDatabase("course", join(directory, "course.db"));
  });

  afterEach(async () => {
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  function addDownloadedVideo(name = "Lesson 1") {
    const module = database.upsertModule("module", "Module", 0);
    const lesson = database.upsertLesson(
      module.id,
      name.toLowerCase().replaceAll(" ", "-"),
      name,
      `https://example.com/${name}`,
      0
    );
    database.markLessonDownloaded(lesson.id);
    return database.recordDownloadedVideo(lesson.id, join(directory, `${name}.mp4`), 1234);
  }

  it("writes human and machine transcripts and records provenance", async () => {
    const video = addDownloadedVideo();
    const runner = vi
      .fn<CuttledocProcessRunner>()
      .mockResolvedValueOnce(versionOutput)
      .mockResolvedValueOnce(transcriptionOutput);
    const progress = vi.fn();

    const summary = await transcribeCourseVideos(database, configSchema.parse({}), {
      transcribe: true,
      transcriptionLanguage: "de-DE",
      transcriptionBackend: "apple-speech",
      runner,
      onProgress: progress,
    });

    expect(summary).toMatchObject({
      attempted: 1,
      completed: 1,
      skipped: 0,
      failures: [],
      cuttledocVersion: "0.1.0",
      processingDurationMs: 900,
    });
    expect(runner).toHaveBeenCalledTimes(2);
    const paths = transcriptOutputPaths(join(directory, "Lesson 1.mp4"));
    expect(JSON.parse(await readFile(paths.jsonPath, "utf8"))).toMatchObject({
      schema_version: "1.0.0",
      text: "Corrected transcript.",
      raw_text: "raw transcript",
    });
    expect(await readFile(paths.markdownPath, "utf8")).toBe(
      "# Lesson 1\n\nCorrected transcript.\n"
    );
    expect(database.getTranscription(video.id)).toMatchObject({
      status: "completed",
      attemptCount: 1,
      cuttledocVersion: "0.1.0",
      language: "de-DE",
      backend: "apple-speech",
      enhancement: "off",
      jsonPath: paths.jsonPath,
      markdownPath: paths.markdownPath,
    });
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ phase: "starting", total: 1 }));
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ phase: "completed", completed: 1 })
    );
  });

  it("continues after failures and retries only unfinished videos", async () => {
    const failed = addDownloadedVideo("Failed");
    const successful = addDownloadedVideo("Successful");
    const runner = vi
      .fn<CuttledocProcessRunner>()
      .mockResolvedValueOnce(versionOutput)
      .mockRejectedValueOnce({
        exitCode: 1,
        stderr: "error[BACKEND_UNAVAILABLE]: unavailable",
      })
      .mockResolvedValueOnce(transcriptionOutput);

    const first = await transcribeCourseVideos(database, configSchema.parse({}), {
      transcribe: true,
      runner,
    });
    expect(first).toMatchObject({ attempted: 2, completed: 1 });
    expect(first.failures).toEqual([
      expect.objectContaining({ videoId: failed.id, code: "BACKEND_UNAVAILABLE" }),
    ]);
    expect(database.getTranscription(failed.id)).toMatchObject({
      status: "error",
      attemptCount: 1,
    });
    expect(database.getTranscription(successful.id)).toMatchObject({
      status: "completed",
      attemptCount: 1,
    });

    const retryRunner = vi
      .fn<CuttledocProcessRunner>()
      .mockResolvedValueOnce(versionOutput)
      .mockResolvedValueOnce(transcriptionOutput);
    const retry = await transcribeCourseVideos(database, configSchema.parse({}), {
      transcribe: true,
      runner: retryRunner,
    });
    expect(retry).toMatchObject({ attempted: 1, completed: 1, failures: [] });
    expect(database.getTranscription(failed.id)).toMatchObject({
      status: "completed",
      attemptCount: 2,
    });
    expect(database.getTranscription(successful.id)).toMatchObject({
      attemptCount: 1,
    });
  });

  it("does not inspect Cuttledoc when there is no pending work", async () => {
    const runner = vi.fn<CuttledocProcessRunner>();
    const summary = await transcribeCourseVideos(database, configSchema.parse({}), {
      transcribe: true,
      runner,
    });
    expect(summary).toMatchObject({
      attempted: 0,
      completed: 0,
      cuttledocVersion: null,
    });
    expect(runner).not.toHaveBeenCalled();
  });
});
