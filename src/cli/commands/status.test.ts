import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  detectSyncPlatform: vi.fn(),
  existsSync: vi.fn(),
  getCourseStateKey: vi.fn(),
  getDbPath: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: mocks.existsSync,
}));
vi.mock("../syncPlatform.js", () => ({
  detectSyncPlatform: mocks.detectSyncPlatform,
}));
vi.mock("../../state/index.js", () => ({
  CourseDatabase: vi.fn(),
  getCourseStateKey: mocks.getCourseStateKey,
  getDbDir: vi.fn(),
  getDbPath: mocks.getDbPath,
  LessonStatus: {
    PENDING: "pending",
    ERROR: "error",
  },
}));

import { statusCommand } from "./status.js";

describe("statusCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocks.detectSyncPlatform.mockReturnValue("highlevel");
    mocks.getCourseStateKey.mockReturnValue("highlevel-courses-example-com-course-id");
    mocks.getDbPath.mockReturnValue("/state/course.db");
    mocks.existsSync.mockReturnValue(false);
  });

  it("resolves state for a supported non-Skool platform", () => {
    const url = "https://courses.example.com/courses/products/course-id";

    statusCommand(url, {});

    expect(mocks.getCourseStateKey).toHaveBeenCalledWith("highlevel", url);
    expect(mocks.getDbPath).toHaveBeenCalledWith("highlevel-courses-example-com-course-id");
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("No sync state found for: highlevel-courses-example-com-course-id")
    );
  });
});
