import { beforeEach, describe, expect, it, vi } from "vitest";
import { withTrailingSilence } from "./audioPadding.js";
import { configSchema } from "../config/schema.js";
import {
  inspectCuttledocVersion,
  resolveCuttledocProcessOptions,
  transcribeWithCuttledoc,
  type CuttledocProcessRunner,
} from "./cuttledoc.js";

vi.mock("./audioPadding.js", () => ({ withTrailingSilence: vi.fn() }));

const resultJson = JSON.stringify({
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
});

describe("Cuttledoc process integration", () => {
  beforeEach(() => {
    vi.mocked(withTrailingSilence).mockReset();
    vi.mocked(withTrailingSilence).mockImplementation(async (_input, _seconds, run) =>
      run("/tmp/padded.wav")
    );
  });

  it("retries an Apple Speech zero-length segment with temporary trailing silence", async () => {
    const runner = vi
      .fn<CuttledocProcessRunner>()
      .mockRejectedValueOnce({
        exitCode: 1,
        stderr: `${"progress\ttranscribing\t1\t100\t-\n".repeat(100)}error[BACKEND_CONTRACT_VIOLATION]: segment 349 has invalid range 90667..90667`,
      })
      .mockResolvedValueOnce({ stdout: resultJson, stderr: "" });
    const run = await transcribeWithCuttledoc(
      "lesson.mp4",
      {
        executable: "cuttledoc",
        language: "de-DE",
        backend: "apple-speech",
        enhancement: "off",
      },
      runner
    );
    expect(withTrailingSilence).toHaveBeenCalledWith("lesson.mp4", 2, expect.any(Function));
    expect(runner.mock.calls[1]?.[1][1]).toBe("/tmp/padded.wav");
    expect(run.result.text).toBe("Corrected transcript.");
    expect(run.result.media_duration_ms).toBe(10_500);
    expect(run.result.preprocessing).toEqual({ trailing_silence_ms: 2000 });
  });

  it("preserves useful diagnostics and does not retry other contract failures", async () => {
    const runner = vi.fn<CuttledocProcessRunner>().mockRejectedValue({
      stderr: `${"progress\ttranscribing\t1\t100\t-\n".repeat(100)}error[BACKEND_CONTRACT_VIOLATION]: segment 4 has invalid range 12..10`,
    });
    await expect(
      transcribeWithCuttledoc(
        "lesson.mp4",
        {
          executable: "cuttledoc",
          language: "de-DE",
          backend: "apple-speech",
          enhancement: "off",
        },
        runner
      )
    ).rejects.toMatchObject({
      message:
        "Cuttledoc failed: error[BACKEND_CONTRACT_VIOLATION]: segment 4 has invalid range 12..10",
    });
    expect(withTrailingSilence).not.toHaveBeenCalled();
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("propagates a failed padded retry without an unbounded retry loop", async () => {
    const runner = vi.fn<CuttledocProcessRunner>().mockRejectedValue({
      stderr: "error[BACKEND_CONTRACT_VIOLATION]: segment 349 has invalid range 90667..90667",
    });
    await expect(
      transcribeWithCuttledoc(
        "lesson.mp4",
        {
          executable: "cuttledoc",
          language: "de-DE",
          backend: "apple-speech",
          enhancement: "off",
        },
        runner
      )
    ).rejects.toMatchObject({ code: "BACKEND_CONTRACT_VIOLATION" });
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("resolves explicit CLI values over safe config defaults", () => {
    const config = configSchema.parse({});
    expect(
      resolveCuttledocProcessOptions(config, {
        cuttledocPath: "/usr/local/bin/cuttledoc",
        transcriptionLanguage: "de-DE",
        transcriptionBackend: "apple-speech",
        transcriptionEnhancement: "local",
      })
    ).toEqual({
      executable: "/usr/local/bin/cuttledoc",
      language: "de-DE",
      backend: "apple-speech",
      enhancement: "local",
    });
    expect(resolveCuttledocProcessOptions(config, {})).toEqual({
      executable: "cuttledoc",
      language: "auto",
      backend: "auto",
      enhancement: "off",
    });
  });

  it("rejects unsupported enhancement modes before starting a process", () => {
    const config = configSchema.parse({});
    expect(() =>
      resolveCuttledocProcessOptions(config, {
        transcriptionEnhancement: "creative",
      })
    ).toThrow("Unsupported transcription enhancement mode: creative");
  });

  it("invokes machine-readable transcription with explicit selection", async () => {
    const runner = vi.fn<CuttledocProcessRunner>().mockResolvedValue({
      stdout: resultJson,
      stderr: "recognizing\t0.5\ncomplete\t1.0\n",
    });

    const run = await transcribeWithCuttledoc(
      "/courses/lesson.mp4",
      {
        executable: "/opt/cuttledoc",
        language: "de-DE",
        backend: "apple-speech",
        enhancement: "off",
      },
      runner
    );

    expect(runner).toHaveBeenCalledWith("/opt/cuttledoc", [
      "transcribe",
      "/courses/lesson.mp4",
      "--language",
      "de-DE",
      "--backend",
      "apple-speech",
      "--enhance",
      "off",
      "--format",
      "json",
      "--progress",
    ]);
    expect(run.result.text).toBe("Corrected transcript.");
    expect(run.result.raw_text).toBe("raw transcript");
    expect(run.progressOutput).toContain("recognizing");
    expect(run.wallDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("validates version and transcription schemas", async () => {
    const versionRunner = vi
      .fn<CuttledocProcessRunner>()
      .mockResolvedValue({ stdout: "cuttledoc 0.1.0\n", stderr: "" });
    await expect(inspectCuttledocVersion({ executable: "cuttledoc" }, versionRunner)).resolves.toBe(
      "0.1.0"
    );

    const invalidRunner = vi
      .fn<CuttledocProcessRunner>()
      .mockResolvedValue({ stdout: '{"kind":"transcription"}', stderr: "" });
    await expect(
      transcribeWithCuttledoc(
        "lesson.mp4",
        {
          executable: "cuttledoc",
          language: "auto",
          backend: "auto",
          enhancement: "off",
        },
        invalidRunner
      )
    ).rejects.toMatchObject({ code: "CUTTLEDOC_OUTPUT_INVALID" });
  });

  it("maps stable Cuttledoc diagnostics and missing executables", async () => {
    const runtimeFailure = vi.fn<CuttledocProcessRunner>().mockRejectedValue({
      exitCode: 1,
      stderr:
        "error[BACKEND_UNAVAILABLE]: Apple Speech is unavailable\nremediation: inspect backends",
    });
    await expect(
      transcribeWithCuttledoc(
        "lesson.mp4",
        {
          executable: "cuttledoc",
          language: "auto",
          backend: "auto",
          enhancement: "off",
        },
        runtimeFailure
      )
    ).rejects.toMatchObject({
      code: "BACKEND_UNAVAILABLE",
      exitCode: 1,
    });

    const missingExecutable = vi.fn<CuttledocProcessRunner>().mockRejectedValue({ code: "ENOENT" });
    await expect(
      inspectCuttledocVersion({ executable: "/missing/cuttledoc" }, missingExecutable)
    ).rejects.toMatchObject({
      code: "CUTTLEDOC_PROCESS_FAILED",
      message: expect.stringContaining("Cuttledoc executable not found: /missing/cuttledoc"),
    });
  });
});
