import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CourseDatabase,
  DATABASE_SCHEMA_VERSION,
  extractCommunitySlug,
  getDbDir,
  getDbPath,
  isSkoolUrl,
  LessonStatus,
  VideoType,
} from "./database.js";
import { CACHE_DIR } from "../config/paths.js";

/** Normalize path to POSIX format for cross-platform test assertions */
const toPosix = (p: string) => p.replace(/\\/g, "/");

describe("extractCommunitySlug", () => {
  it("extracts slug from standard Skool URL", () => {
    expect(extractCommunitySlug("https://www.skool.com/my-community")).toBe("my-community");
  });

  it("extracts slug from Skool URL without www", () => {
    expect(extractCommunitySlug("https://skool.com/test-group")).toBe("test-group");
  });

  it("extracts slug from URL with path", () => {
    expect(extractCommunitySlug("https://www.skool.com/my-community/classroom")).toBe(
      "my-community"
    );
    expect(extractCommunitySlug("https://www.skool.com/my-community/classroom/lessons/123")).toBe(
      "my-community"
    );
  });

  it("extracts the same slug from referral and fragmented URLs", () => {
    expect(extractCommunitySlug("https://www.skool.com/my-community?ref=abc")).toBe("my-community");
    expect(extractCommunitySlug("https://www.skool.com/my-community#classroom")).toBe(
      "my-community"
    );
  });

  it("handles complex community names", () => {
    expect(extractCommunitySlug("https://skool.com/the-best-community-ever-2024")).toBe(
      "the-best-community-ever-2024"
    );
  });

  it("returns 'unknown' for non-Skool URLs", () => {
    expect(extractCommunitySlug("https://example.com/path")).toBe("unknown");
    expect(extractCommunitySlug("https://youtube.com/channel/abc")).toBe("unknown");
  });

  it("returns 'unknown' for invalid URLs", () => {
    expect(extractCommunitySlug("not-a-url")).toBe("unknown");
    expect(extractCommunitySlug("")).toBe("unknown");
  });

  it("returns 'unknown' for Skool root URL", () => {
    expect(extractCommunitySlug("https://www.skool.com/")).toBe("unknown");
    expect(extractCommunitySlug("https://www.skool.com")).toBe("unknown");
  });
});

describe("isSkoolUrl", () => {
  it("accepts Skool hosts and subdomains", () => {
    expect(isSkoolUrl("https://skool.com/community")).toBe(true);
    expect(isSkoolUrl("https://www.skool.com/community/classroom")).toBe(true);
  });

  it("rejects lookalike hosts and query-string mentions", () => {
    expect(isSkoolUrl("https://evilskool.com/community")).toBe(false);
    expect(isSkoolUrl("https://evil.com/?next=https://skool.com/community")).toBe(false);
  });

  it("rejects invalid and non-web URLs", () => {
    expect(isSkoolUrl("not-a-url")).toBe(false);
    expect(isSkoolUrl("ftp://skool.com/community")).toBe(false);
  });
});

describe("getDbDir", () => {
  it("returns the CACHE_DIR", () => {
    expect(getDbDir()).toBe(CACHE_DIR);
  });

  it("returns a string path", () => {
    const dir = getDbDir();
    expect(typeof dir).toBe("string");
    expect(dir.length).toBeGreaterThan(0);
  });
});

describe("getDbPath", () => {
  it("creates a path with .db extension", () => {
    const path = getDbPath("my-community");
    expect(path).toContain(".db");
    expect(path.endsWith(".db")).toBe(true);
  });

  it("uses the community slug in the filename", () => {
    const path = getDbPath("awesome-course");
    expect(path).toContain("awesome-course");
  });

  it("joins CACHE_DIR with the slug-based filename", () => {
    const path = toPosix(getDbPath("test-slug"));
    expect(path).toBe(`${toPosix(CACHE_DIR)}/test-slug.db`);
  });

  it("sanitizes special characters in slug", () => {
    const path = toPosix(getDbPath("my/special:slug*with?chars"));
    // Special chars should be replaced with underscore
    expect(path).toBe(`${toPosix(CACHE_DIR)}/my_special_slug_with_chars.db`);
  });

  it("preserves hyphens and underscores", () => {
    const path = getDbPath("my-community_2024");
    expect(path).toContain("my-community_2024");
  });

  it("handles alphanumeric slugs unchanged", () => {
    const path = toPosix(getDbPath("Community123"));
    expect(path).toBe(`${toPosix(CACHE_DIR)}/Community123.db`);
  });
});

describe("CourseDatabase", () => {
  let directory: string;
  let databases: CourseDatabase[];

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "offcourse-database-"));
    databases = [];
  });

  afterEach(() => {
    for (const database of databases) database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function createDatabase(filename = "course.db"): CourseDatabase {
    const database = new CourseDatabase("test-course", join(directory, filename));
    databases.push(database);
    return database;
  }

  function addLesson(database: CourseDatabase, slug = "lesson-1") {
    const module = database.upsertModule("module-1", "Module 1", 0);
    return database.upsertLesson(
      module.id,
      slug,
      "Lesson 1",
      `https://www.skool.com/test-course/classroom/${slug}`,
      0
    );
  }

  it("creates the complete current schema and unique URL index", () => {
    createDatabase();
    const raw = new Database(join(directory, "course.db"), { readonly: true });

    expect(raw.pragma("user_version", { simple: true })).toBe(DATABASE_SCHEMA_VERSION);
    expect(
      (raw.prepare("PRAGMA table_info(lessons)").all() as { name: string }[]).map(
        (column) => column.name
      )
    ).toContain("retry_count");
    const indexes = raw.prepare("PRAGMA index_list(lessons)").all() as {
      name: string;
      unique: number;
    }[];
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "idx_lessons_url", unique: 0 }),
        expect.objectContaining({ name: "idx_lessons_url_unique", unique: 1 }),
      ])
    );

    raw.close();
  });

  it("creates a missing parent directory for an injected database path", () => {
    const database = createDatabase("nested/course.db");
    expect(database.getCourseMetadata().totalLessons).toBe(0);
  });

  it("migrates a legacy lessons table in order and idempotently", () => {
    const path = join(directory, "legacy.db");
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE lessons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        module_id INTEGER NOT NULL,
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        position INTEGER NOT NULL,
        status TEXT DEFAULT 'pending',
        video_type TEXT,
        video_url TEXT,
        hls_url TEXT,
        error_message TEXT,
        error_code TEXT,
        last_scanned_at TEXT,
        last_downloaded_at TEXT,
        video_file_size INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(module_id, slug)
      );
    `);
    legacy.close();

    const database = new CourseDatabase("legacy", path);
    databases.push(database);
    const raw = new Database(path, { readonly: true });
    const columns = (raw.prepare("PRAGMA table_info(lessons)").all() as { name: string }[]).map(
      (column) => column.name
    );
    const indexes = (raw.prepare("PRAGMA index_list(lessons)").all() as { name: string }[]).map(
      (index) => index.name
    );

    expect(columns).toEqual(expect.arrayContaining(["is_locked", "retry_count"]));
    expect(indexes).toEqual(expect.arrayContaining(["idx_lessons_url", "idx_lessons_url_unique"]));
    expect(raw.pragma("user_version", { simple: true })).toBe(DATABASE_SCHEMA_VERSION);

    raw.close();

    const reopened = new CourseDatabase("legacy", path);
    databases.push(reopened);
    expect(reopened.getLessonCount()).toBe(0);
  });

  it("deduplicates legacy lesson URLs before enforcing uniqueness", () => {
    const path = join(directory, "duplicate-urls.db");
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE modules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        position INTEGER NOT NULL,
        is_locked INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE lessons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        module_id INTEGER NOT NULL,
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        position INTEGER NOT NULL,
        is_locked INTEGER DEFAULT 0,
        status TEXT DEFAULT 'pending',
        video_type TEXT,
        video_url TEXT,
        hls_url TEXT,
        error_message TEXT,
        error_code TEXT,
        retry_count INTEGER DEFAULT 0,
        last_scanned_at TEXT,
        last_downloaded_at TEXT,
        video_file_size INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(module_id, slug)
      );
      INSERT INTO modules (slug, name, position) VALUES ('one', 'One', 0), ('two', 'Two', 1);
      INSERT INTO lessons (module_id, slug, name, url, position, status)
        VALUES
          (1, 'pending', 'Pending', 'https://example.com/stable', 0, 'pending'),
          (2, 'done', 'Done', 'https://example.com/stable', 0, 'downloaded');
      PRAGMA user_version = 2;
    `);
    legacy.close();

    const database = new CourseDatabase("legacy", path);
    databases.push(database);
    expect(database.getLessons()).toEqual([
      expect.objectContaining({ name: "Done", status: LessonStatus.DOWNLOADED }),
    ]);

    const raw = new Database(path);
    expect(() =>
      raw
        .prepare(
          "INSERT INTO lessons (module_id, slug, name, url, position) VALUES (?, ?, ?, ?, ?)"
        )
        .run(1, "duplicate", "Duplicate", "https://example.com/stable", 1)
    ).toThrow(/UNIQUE constraint failed/);
    raw.close();
  });

  it("stores metadata and derives course totals", () => {
    const database = createDatabase();
    expect(database.getMetadata("missing")).toBeNull();
    expect(database.getCourseMetadata()).toEqual({
      name: "Unknown Course",
      url: "",
      lastSyncAt: null,
      totalModules: 0,
      totalLessons: 0,
    });

    addLesson(database);
    database.setMetadata("custom", "value");
    database.updateCourseMetadata("Course name", "https://www.skool.com/test-course");

    expect(database.getMetadata("custom")).toBe("value");
    expect(database.getCourseMetadata()).toMatchObject({
      name: "Course name",
      url: "https://www.skool.com/test-course",
      totalModules: 1,
      totalLessons: 1,
    });
    expect(database.getCourseMetadata().lastSyncAt).not.toBeNull();
  });

  it("upserts modules and lessons without replacing their state records", () => {
    const database = createDatabase();
    const module = database.upsertModule("module-1", "Original", 0);
    const lesson = database.upsertLesson(
      module.id,
      "lesson-1",
      "Original lesson",
      "https://www.skool.com/test-course/classroom/lesson-1",
      0
    );

    const updatedModule = database.upsertModule("module-1", "Renamed", 2, true);
    const updatedLesson = database.upsertLesson(
      module.id,
      "lesson-1",
      "Renamed lesson",
      "https://www.skool.com/test-course/classroom/lesson-1",
      3,
      true
    );

    expect(updatedModule).toMatchObject({ id: module.id, name: "Renamed", position: 2 });
    expect(updatedLesson).toMatchObject({
      id: lesson.id,
      name: "Renamed lesson",
      position: 3,
      isLocked: true,
      status: LessonStatus.PENDING,
      retryCount: 0,
    });
  });

  it("merges a colliding module slug without orphaning legacy lessons", () => {
    const database = createDatabase();
    const legacyModule = database.upsertModule("module-0", "Module", 0, true);
    const destinationModule = database.upsertModule("module-0-stable", "Module", 0);
    const legacyLesson = database.upsertLesson(
      legacyModule.id,
      "legacy-lesson",
      "Legacy lesson",
      "https://example.com/legacy-lesson",
      0
    );

    const merged = database.renameModuleSlug("module-0", "module-0-stable");

    expect(merged).toMatchObject({ id: destinationModule.id, slug: "module-0-stable" });
    expect(database.getModuleBySlug("module-0")).toBeNull();
    expect(database.getModules()).toHaveLength(1);
    expect(database.getLessonByUrl(legacyLesson.url)).toMatchObject({
      id: legacyLesson.id,
      moduleId: destinationModule.id,
    });
  });

  it("preserves lesson state when a stable URL moves to another module", () => {
    const database = createDatabase();
    const originalModule = database.upsertModule("module-1", "Original module", 0);
    const nextModule = database.upsertModule("module-2", "Next module", 1);
    const lesson = database.upsertLesson(
      originalModule.id,
      "lesson-1",
      "Original lesson",
      "https://example.com/lessons/stable-id",
      0
    );
    database.markLessonDownloaded(lesson.id, 1234);

    const moved = database.upsertLesson(
      nextModule.id,
      "lesson-1",
      "Renamed lesson",
      "https://example.com/lessons/stable-id",
      4
    );

    expect(moved).toMatchObject({
      id: lesson.id,
      moduleId: nextModule.id,
      name: "Renamed lesson",
      position: 4,
      status: LessonStatus.DOWNLOADED,
      videoFileSize: 1234,
    });
    expect(database.getLessonCount()).toBe(1);
  });

  it("orders and joins module and lesson records", () => {
    const database = createDatabase();
    const secondModule = database.upsertModule("module-2", "Second", 1, true);
    const firstModule = database.upsertModule("module-1", "First", 0);
    const secondLesson = database.upsertLesson(
      secondModule.id,
      "lesson-2",
      "Second lesson",
      "https://www.skool.com/test-course/classroom/lesson-2",
      0,
      true
    );
    const firstLesson = database.upsertLesson(
      firstModule.id,
      "lesson-1",
      "First lesson",
      "https://www.skool.com/test-course/classroom/lesson-1",
      0
    );

    expect(database.getModules().map(({ id }) => id)).toEqual([firstModule.id, secondModule.id]);
    expect(database.getModuleBySlug("module-1")).toMatchObject({ id: firstModule.id });
    expect(database.getModuleBySlug("missing")).toBeNull();
    expect(database.getLessons().map(({ id }) => id)).toEqual([secondLesson.id, firstLesson.id]);
    expect(database.getLessonsWithModules().map(({ id }) => id)).toEqual([
      firstLesson.id,
      secondLesson.id,
    ]);
    expect(database.getLessonsWithModules()[0]).toMatchObject({
      moduleName: "First",
      moduleSlug: "module-1",
      modulePosition: 0,
    });
    expect(database.getLessonByUrl(firstLesson.url)).toMatchObject({ id: firstLesson.id });
    expect(database.getLessonByUrl("https://example.com/missing")).toBeNull();
    expect(database.getStatusSummary()).toMatchObject({ pending: 2, locked: 1 });
  });

  it("moves lessons through scan, validation, and download queries", () => {
    const database = createDatabase();
    const lesson = addLesson(database);

    expect(database.getLessonsToScan().map(({ id }) => id)).toEqual([lesson.id]);

    database.updateLessonScan(
      lesson.id,
      VideoType.VIMEO,
      "https://vimeo.com/123",
      null,
      LessonStatus.SCANNED
    );
    expect(database.getLessonsToValidate().map(({ id }) => id)).toEqual([lesson.id]);

    database.updateLessonScan(
      lesson.id,
      VideoType.VIMEO,
      "https://vimeo.com/123",
      "https://cdn.example/video.m3u8",
      LessonStatus.VALIDATED
    );
    expect(database.getLessonsToDownload().map(({ id }) => id)).toEqual([lesson.id]);

    database.markLessonDownloaded(lesson.id, 1234);
    expect(database.getLessonsByStatus(LessonStatus.DOWNLOADED)[0]).toMatchObject({
      id: lesson.id,
      videoFileSize: 1234,
    });
  });

  it("tracks retry state and excludes unsupported providers", () => {
    const database = createDatabase();
    const retryable = addLesson(database, "retryable");
    const unsupported = addLesson(database, "unsupported");

    database.markLessonError(retryable.id, "Temporary failure", "TIMEOUT");
    database.markLessonError(unsupported.id, "Unsupported", "UNSUPPORTED_PROVIDER");
    expect(database.incrementRetryCount(retryable.id)).toBe(1);
    expect(database.getLessonsToRetry(3).map(({ id }) => id)).toEqual([retryable.id]);

    database.queueForRetry(retryable.id, LessonStatus.VALIDATED);
    expect(database.getLessonsByStatus(LessonStatus.VALIDATED)[0]).toMatchObject({
      id: retryable.id,
      errorMessage: null,
      errorCode: null,
      retryCount: 1,
    });

    database.markLessonError(retryable.id, "Temporary failure", "TIMEOUT");
    expect(database.incrementRetryCount(retryable.id)).toBe(2);
    database.resetRetryCount(retryable.id);
    expect(database.getLessonByUrl(retryable.url)?.retryCount).toBe(0);
    expect(database.incrementRetryCount(999_999)).toBe(0);
  });

  it("supports error, skip, retry queueing, and force-reset state transitions", () => {
    const database = createDatabase();
    const withHls = addLesson(database, "with-hls");
    const withoutHls = addLesson(database, "without-hls");

    database.updateLessonScan(
      withHls.id,
      VideoType.VIMEO,
      "https://vimeo.com/123",
      "https://cdn.example/video.m3u8",
      LessonStatus.VALIDATED,
      "old error",
      "OLD_ERROR"
    );
    database.updateLessonVideoType(withoutHls.id, VideoType.LOOM);
    database.markLessonSkipped(withoutHls.id, "No video");
    expect(database.getLessonsByStatus(LessonStatus.SKIPPED)[0]).toMatchObject({
      id: withoutHls.id,
      videoType: VideoType.LOOM,
      errorMessage: "No video",
    });

    database.markLessonError(withHls.id, "Download failed", "TIMEOUT");
    database.markLessonError(withoutHls.id, "Scan failed");
    expect(database.getLessonsByErrorCode("TIMEOUT").map(({ id }) => id)).toEqual([withHls.id]);
    database.queueForRetry(withHls.id, LessonStatus.VALIDATED);
    expect(database.getLessonsByStatus(LessonStatus.VALIDATED).map(({ id }) => id)).toEqual([
      withHls.id,
    ]);
    database.queueForRetry(withoutHls.id);
    expect(database.getLessonsByStatus(LessonStatus.PENDING).map(({ id }) => id)).toEqual([
      withoutHls.id,
    ]);

    database.incrementRetryCount(withHls.id);
    expect(database.resetAllLessonsToPending()).toBe(2);
    expect(database.getLessons()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: LessonStatus.PENDING,
          videoType: null,
          videoUrl: null,
          hlsUrl: null,
          retryCount: 0,
        }),
      ])
    );
  });

  it("summarizes video types and clears download errors", () => {
    const database = createDatabase();
    const vimeo = addLesson(database, "vimeo");
    const loom = addLesson(database, "loom");

    database.updateLessonVideoType(vimeo.id, VideoType.VIMEO);
    database.updateLessonVideoType(loom.id, VideoType.LOOM);
    database.markLessonError(vimeo.id, "Temporary", "TIMEOUT");
    database.markLessonDownloaded(vimeo.id);
    database.markLessonSkipped(loom.id);

    expect(database.getVideoTypeSummary()).toEqual({ loom: 1, vimeo: 1 });
    expect(database.getLessonByUrl(vimeo.url)).toMatchObject({
      status: LessonStatus.DOWNLOADED,
      errorMessage: null,
      errorCode: null,
      videoFileSize: null,
    });
    expect(database.getLessonByUrl(loom.url)).toMatchObject({
      status: LessonStatus.SKIPPED,
      errorMessage: null,
    });
  });

  it("rolls back a group of state changes when one write fails", () => {
    const database = createDatabase();

    expect(() =>
      database.withTransaction(() => {
        addLesson(database);
        throw new Error("stop persistence");
      })
    ).toThrow("stop persistence");
    expect(database.getModuleCount()).toBe(0);
    expect(database.getLessonCount()).toBe(0);
    expect(database.withTransaction(() => "committed")).toBe("committed");
  });
});
