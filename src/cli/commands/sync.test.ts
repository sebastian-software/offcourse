import { describe, expect, it, vi } from "vitest";
import {
  hasLessonsPendingValidation,
  redactDownloadUrl,
  redactDownloadUrlsInText,
} from "./sync.js";

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

describe("redactDownloadUrl", () => {
  it("removes signed query parameters, fragments, and user info", () => {
    expect(
      redactDownloadUrl(
        "https://user:password@cdn.example.com/video.m3u8?token=secret&expires=123#segment"
      )
    ).toBe("https://cdn.example.com/video.m3u8");
  });

  it("fully redacts opaque and invalid URLs", () => {
    expect(redactDownloadUrl("segments:c2VjcmV0LXNpZ25lZC11cmw=")).toBe("segments:[redacted]");
    expect(redactDownloadUrl("not a valid url?token=secret")).toBe("[redacted]");
  });

  it("redacts signed URLs embedded in diagnostic text", () => {
    expect(
      redactDownloadUrlsInText(
        "Playlist failed: https://cdn.example.com/video.m3u8?token=secret; fallback segments:c2VjcmV0"
      )
    ).toBe("Playlist failed: https://cdn.example.com/video.m3u8 fallback segments:[redacted]");
  });
});
