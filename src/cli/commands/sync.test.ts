import { describe, expect, it, vi } from "vitest";
import { hasLessonsPendingValidation } from "./sync.js";

describe("hasLessonsPendingValidation", () => {
  it("starts validation for newly inserted pending lessons", () => {
    const getLessonsToScan = vi.fn(() => [{} as never]);

    expect(hasLessonsPendingValidation({ getLessonsToScan })).toBe(true);
    expect(getLessonsToScan).toHaveBeenCalledOnce();
  });

  it("skips validation only when no lesson needs scanning", () => {
    const getLessonsToScan = vi.fn(() => []);

    expect(hasLessonsPendingValidation({ getLessonsToScan })).toBe(false);
  });
});
