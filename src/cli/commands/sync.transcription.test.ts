import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configSchema } from "../../config/schema.js";
import { CourseDatabase, LessonStatus } from "../../state/database.js";
import {
  createCourseDirectory,
  createModuleDirectory,
  getVideoPath,
} from "../../storage/fileSystem.js";

const mocks = vi.hoisted(() => ({
  database: vi.fn<() => CourseDatabase>(),
  config: vi.fn(),
  authenticate: vi.fn(),
  version: vi.fn(),
  transcribe: vi.fn(),
}));

vi.mock("../../state/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../state/index.js")>()),
  CourseDatabase: vi.fn(function () {
    return mocks.database();
  }),
}));
vi.mock("../../config/configManager.js", () => ({ loadConfig: mocks.config }));
vi.mock("../../shared/auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../shared/auth.js")>()),
  getAuthenticatedSession: mocks.authenticate,
}));
vi.mock("../../shared/shutdown.js", () => ({
  createShutdownManager: () => ({
    setup: vi.fn(),
    registerCleanup: vi.fn(),
    shouldContinue: () => true,
  }),
}));
vi.mock("../../transcription/cuttledoc.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../transcription/cuttledoc.js")>()),
  inspectCuttledocVersion: mocks.version,
  transcribeWithCuttledoc: mocks.transcribe,
}));

import { syncCommand } from "./sync.js";

describe("sync transcript backfill for a previously downloaded course", () => {
  let directory: string;
  let videoPath: string;
  const url = "https://www.skool.com/course/classroom";

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    directory = await mkdtemp(join(tmpdir(), "offcourse-sync-transcripts-"));
    const databasePath = join(directory, "state.db");
    mocks.config.mockReturnValue(configSchema.parse({ outputDir: directory }));
    mocks.database.mockImplementation(() => new CourseDatabase("course", databasePath));
    const database = new CourseDatabase("course", databasePath);
    const module = database.upsertModule("module", "Module", 0);
    const lesson = database.upsertLesson(module.id, "lesson", "Lesson", `${url}/lesson`, 0);
    database.updateLessonScan(lesson.id, "hls", null, null, LessonStatus.DOWNLOADED);
    database.close();
    const courseDir = await createCourseDirectory(directory, "course");
    const moduleDir = await createModuleDirectory(courseDir, 0, "Module");
    videoPath = getVideoPath(moduleDir, 0, "Lesson");
    await writeFile(videoPath, "existing video");
    mocks.version.mockResolvedValue("3.0.0");
    mocks.transcribe.mockResolvedValue({
      result: {
        schema_version: "1.0.0",
        kind: "transcription",
        raw_text: "Original words",
        text: "Readable words.",
        language: "en",
        backend: "whisper",
        model: null,
        media_duration_ms: 1000,
        processing_duration_ms: 1,
        enhancement: null,
      },
      wallDurationMs: 2,
      progressOutput: "",
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it("discovers an old download, transcribes it, and skips it on the next sync without opening a browser", async () => {
    await syncCommand(url, {});
    expect(mocks.transcribe).toHaveBeenCalledOnce();
    expect(mocks.transcribe).toHaveBeenCalledWith(videoPath, expect.any(Object), undefined);
    expect(await readFile(videoPath.replace(/\.mp4$/, ".transcript.md"), "utf8")).toContain(
      "Readable words."
    );
    expect(await readFile(videoPath, "utf8")).toBe("existing video");

    mocks.transcribe.mockClear();
    mocks.version.mockClear();
    await syncCommand(url, {});
    expect(mocks.transcribe).not.toHaveBeenCalled();
    expect(mocks.version).not.toHaveBeenCalled();
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });

  it("leaves transcripts missing when explicitly disabled", async () => {
    await syncCommand(url, { transcribe: false });
    expect(mocks.transcribe).not.toHaveBeenCalled();
    expect(mocks.authenticate).not.toHaveBeenCalled();
    await expect(readFile(videoPath.replace(/\.mp4$/, ".transcript.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
