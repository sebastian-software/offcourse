import { describe, expect, it } from "vitest";
import { configSchema, courseSyncStateSchema, sessionInfoSchema } from "./schema.js";

describe("configSchema", () => {
  it("parses empty object with defaults", () => {
    const result = configSchema.parse({});
    expect(result).toEqual({
      outputDir: "~/Downloads/offcourse",
      videoQuality: "highest",
      concurrency: 2,
      retryAttempts: 3,
      headless: true,
    });
  });

  it("accepts valid config values", () => {
    const input = {
      outputDir: "/custom/path",
      videoQuality: "720p" as const,
      concurrency: 4,
      retryAttempts: 5,
      headless: false,
    };
    const result = configSchema.parse(input);
    expect(result).toEqual(input);
  });

  it("rejects invalid video quality", () => {
    expect(() => configSchema.parse({ videoQuality: "4k" })).toThrow();
  });

  it("rejects concurrency outside valid range", () => {
    expect(() => configSchema.parse({ concurrency: 0 })).toThrow();
    expect(() => configSchema.parse({ concurrency: 6 })).toThrow();
  });

  it("rejects retry attempts outside valid range", () => {
    expect(() => configSchema.parse({ retryAttempts: -1 })).toThrow();
    expect(() => configSchema.parse({ retryAttempts: 11 })).toThrow();
  });

  it("accepts all valid video quality values", () => {
    const qualities = ["highest", "lowest", "1080p", "720p", "480p"] as const;
    for (const quality of qualities) {
      const result = configSchema.parse({ videoQuality: quality });
      expect(result.videoQuality).toBe(quality);
    }
  });
});

describe("courseSyncStateSchema", () => {
  it("validates minimal course sync state", () => {
    const input = {
      url: "https://example.com/course",
      name: "My Course",
      modules: [],
    };
    const result = courseSyncStateSchema.parse(input);
    expect(result.url).toBe(input.url);
    expect(result.name).toBe(input.name);
    expect(result.modules).toEqual([]);
  });

  it("validates complete course sync state", () => {
    const input = {
      url: "https://example.com/course",
      name: "My Course",
      lastSyncedAt: "2024-01-15T10:30:00.000Z",
      modules: [
        {
          name: "Module 1",
          slug: "abc12345",
          lessons: [
            {
              name: "Lesson 1",
              slug: "def67890",
              url: "https://example.com/lesson/1",
              isCompleted: true,
              videoDownloaded: true,
              contentSaved: true,
            },
          ],
        },
      ],
    };
    const result = courseSyncStateSchema.parse(input);
    expect(result).toEqual(input);
  });

  it("applies default values for lesson flags", () => {
    const input = {
      url: "https://example.com/course",
      name: "My Course",
      modules: [
        {
          name: "Module 1",
          slug: "abc12345",
          lessons: [
            {
              name: "Lesson 1",
              slug: "def67890",
              url: "https://example.com/lesson/1",
            },
          ],
        },
      ],
    };
    const result = courseSyncStateSchema.parse(input);
    const lesson = result.modules[0]?.lessons[0];
    expect(lesson?.isCompleted).toBe(false);
    expect(lesson?.videoDownloaded).toBe(false);
    expect(lesson?.contentSaved).toBe(false);
  });

  it("rejects invalid URL", () => {
    expect(() =>
      courseSyncStateSchema.parse({
        url: "not-a-url",
        name: "Course",
        modules: [],
      })
    ).toThrow();
  });

  it("rejects invalid datetime format", () => {
    expect(() =>
      courseSyncStateSchema.parse({
        url: "https://example.com/course",
        name: "Course",
        lastSyncedAt: "invalid-date",
        modules: [],
      })
    ).toThrow();
  });
});

describe("sessionInfoSchema", () => {
  it("validates complete session info", () => {
    const input = {
      domain: "example.com",
      createdAt: "2024-01-15T10:30:00.000Z",
      expiresAt: "2024-02-15T10:30:00.000Z",
    };
    const result = sessionInfoSchema.parse(input);
    expect(result).toEqual(input);
  });

  it("accepts session without expiry", () => {
    const input = {
      domain: "example.com",
      createdAt: "2024-01-15T10:30:00.000Z",
    };
    const result = sessionInfoSchema.parse(input);
    expect(result.expiresAt).toBeUndefined();
  });

  it("rejects invalid createdAt datetime", () => {
    expect(() =>
      sessionInfoSchema.parse({
        domain: "example.com",
        createdAt: "not-a-date",
      })
    ).toThrow();
  });

  it("requires domain field", () => {
    expect(() =>
      sessionInfoSchema.parse({
        createdAt: "2024-01-15T10:30:00.000Z",
      })
    ).toThrow();
  });
});
