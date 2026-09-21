import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../config/schema.js";
import type { CourseDatabase } from "../state/index.js";

const mocks = vi.hoisted(() => ({
  transcribeCourseVideos: vi.fn(),
}));

vi.mock("../transcription/index.js", () => ({
  transcribeCourseVideos: mocks.transcribeCourseVideos,
}));

import { runRequestedTranscription } from "./syncPipeline.js";

const config = {
  outputDir: "/courses",
  videoQuality: "highest",
  concurrency: 2,
  extractionConcurrency: 4,
  retryAttempts: 3,
  headless: true,
  cuttledocPath: "cuttledoc",
  transcriptionLanguage: "auto",
  transcriptionBackend: "auto",
  transcriptionEnhancement: "off",
} satisfies Config;

const database = {} as CourseDatabase;

describe("runRequestedTranscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([{ transcribe: false }, { dryRun: true }])(
    "skips transcription for %j",
    async (options) => {
      await expect(runRequestedTranscription(database, config, options)).resolves.toBeNull();
      expect(mocks.transcribeCourseVideos).not.toHaveBeenCalled();
    }
  );

  it("transcribes by default without an opt-in flag", async () => {
    mocks.transcribeCourseVideos.mockResolvedValue({ attempted: 0, failures: [] });
    await runRequestedTranscription(database, config, {});
    expect(mocks.transcribeCourseVideos).toHaveBeenCalledOnce();
  });

  it("forwards CLI overrides and returns the completed summary", async () => {
    const summary = {
      attempted: 1,
      completed: 1,
      skipped: 0,
      failures: [],
      cuttledocVersion: "3.0.0",
      wallDurationMs: 1200,
      processingDurationMs: 1000,
      estimatedProcessOverheadMs: 200,
    };
    mocks.transcribeCourseVideos.mockResolvedValue(summary);
    const shouldContinue = () => true;

    await expect(
      runRequestedTranscription(
        database,
        config,
        {
          transcribe: true,
          cuttledocPath: "/opt/cuttledoc",
          transcriptionLanguage: "de",
        },
        shouldContinue
      )
    ).resolves.toBe(summary);

    expect(mocks.transcribeCourseVideos).toHaveBeenCalledWith(
      database,
      config,
      expect.objectContaining({
        transcribe: true,
        cuttledocPath: "/opt/cuttledoc",
        transcriptionLanguage: "de",
        shouldContinue,
        onProgress: expect.any(Function),
      })
    );
  });

  it("keeps failed jobs retryable and fails the requested sync stage", async () => {
    mocks.transcribeCourseVideos.mockResolvedValue({
      attempted: 1,
      completed: 0,
      skipped: 0,
      failures: [
        {
          videoId: 1,
          videoPath: "/courses/lesson.mp4",
          lessonName: "Lesson",
          code: "CUTTLEDOC_FAILED",
          message: "failed",
        },
      ],
      cuttledocVersion: "3.0.0",
      wallDurationMs: 0,
      processingDurationMs: 0,
      estimatedProcessOverheadMs: 0,
    });

    await expect(runRequestedTranscription(database, config, { transcribe: true })).rejects.toThrow(
      "rerun sync to retry missing transcripts"
    );
  });
});
