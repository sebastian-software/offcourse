import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { APP_DIR } from "../config/paths.js";

/**
 * Lesson sync status.
 */
export const LessonStatus = {
  PENDING: "pending",
  SCANNED: "scanned",
  VALIDATED: "validated",
  DOWNLOADED: "downloaded",
  ERROR: "error",
  SKIPPED: "skipped",
} as const;

export type LessonStatusType = (typeof LessonStatus)[keyof typeof LessonStatus];

/**
 * Video types supported by the tool.
 */
export const VideoType = {
  LOOM: "loom",
  VIMEO: "vimeo",
  YOUTUBE: "youtube",
  WISTIA: "wistia",
  NATIVE: "native",
  UNKNOWN: "unknown",
} as const;

export type VideoTypeValue = (typeof VideoType)[keyof typeof VideoType];

/**
 * Module record from database.
 */
export interface ModuleRecord {
  id: number;
  slug: string;
  name: string;
  position: number;
  isLocked: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Lesson record from database.
 */
export interface LessonRecord {
  id: number;
  moduleId: number;
  slug: string;
  name: string;
  url: string;
  position: number;
  isLocked: boolean;
  status: LessonStatusType;
  videoType: VideoTypeValue | null;
  videoUrl: string | null;
  hlsUrl: string | null;
  errorMessage: string | null;
  errorCode: string | null;
  lastScannedAt: string | null;
  lastDownloadedAt: string | null;
  videoFileSize: number | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Lesson with module info for display.
 */
export interface LessonWithModule extends LessonRecord {
  moduleName: string;
  moduleSlug: string;
  modulePosition: number;
}

/**
 * Course metadata stored in the database.
 */
export interface CourseMetadata {
  name: string;
  url: string;
  lastSyncAt: string | null;
  totalModules: number;
  totalLessons: number;
}

/**
 * Get the database directory path.
 */
export function getDbDir(): string {
  return join(APP_DIR, "cache");
}

/**
 * Get the database file path for a course.
 */
export function getDbPath(communitySlug: string): string {
  const safeSlug = communitySlug.replace(/[^a-zA-Z0-9-]/g, "_");
  return join(getDbDir(), `${safeSlug}.db`);
}

/**
 * Extract community slug from a Skool URL.
 */
export function extractCommunitySlug(url: string): string {
  const match = url.match(/skool\.com\/([^/]+)/);
  return match?.[1] ?? "unknown";
}

/**
 * Database manager for course state persistence.
 */
export class CourseDatabase {
  private db: Database.Database;

  constructor(communitySlug: string) {
    const dbPath = getDbPath(communitySlug);

    // Ensure directory exists
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initSchema();
  }

  /**
   * Initialize database schema.
   */
  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS modules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        position INTEGER NOT NULL,
        is_locked INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS lessons (
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
        last_scanned_at TEXT,
        last_downloaded_at TEXT,
        video_file_size INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (module_id) REFERENCES modules(id),
        UNIQUE(module_id, slug)
      );

      CREATE INDEX IF NOT EXISTS idx_lessons_status ON lessons(status);
      CREATE INDEX IF NOT EXISTS idx_lessons_module ON lessons(module_id);
      CREATE INDEX IF NOT EXISTS idx_lessons_locked ON lessons(is_locked);
    `);

    // Run migrations for existing databases
    this.runMigrations();
  }

  /**
   * Run database migrations for schema updates.
   */
  private runMigrations(): void {
    // Migration: Add is_locked column if it doesn't exist
    const tableInfo = this.db.prepare("PRAGMA table_info(lessons)").all() as Array<{ name: string }>;
    const hasIsLocked = tableInfo.some((col) => col.name === "is_locked");
    if (!hasIsLocked) {
      this.db.exec("ALTER TABLE lessons ADD COLUMN is_locked INTEGER DEFAULT 0");
    }
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }

  // ============================================
  // Metadata Operations
  // ============================================

  /**
   * Set a metadata value.
   */
  setMetadata(key: string, value: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO metadata (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    stmt.run(key, value);
  }

  /**
   * Get a metadata value.
   */
  getMetadata(key: string): string | null {
    const stmt = this.db.prepare("SELECT value FROM metadata WHERE key = ?");
    const row = stmt.get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  /**
   * Get all course metadata.
   */
  getCourseMetadata(): CourseMetadata {
    return {
      name: this.getMetadata("course_name") ?? "Unknown Course",
      url: this.getMetadata("course_url") ?? "",
      lastSyncAt: this.getMetadata("last_sync_at"),
      totalModules: this.getModuleCount(),
      totalLessons: this.getLessonCount(),
    };
  }

  /**
   * Update course metadata after sync.
   */
  updateCourseMetadata(name: string, url: string): void {
    this.setMetadata("course_name", name);
    this.setMetadata("course_url", url);
    this.setMetadata("last_sync_at", new Date().toISOString());
  }

  // ============================================
  // Module Operations
  // ============================================

  /**
   * Upsert a module (insert or update).
   */
  upsertModule(slug: string, name: string, position: number, isLocked = false): ModuleRecord {
    const stmt = this.db.prepare(`
      INSERT INTO modules (slug, name, position, is_locked, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(slug) DO UPDATE SET
        name = excluded.name,
        position = excluded.position,
        is_locked = excluded.is_locked,
        updated_at = datetime('now')
      RETURNING *
    `);
    const row = stmt.get(slug, name, position, isLocked ? 1 : 0) as {
      id: number;
      slug: string;
      name: string;
      position: number;
      is_locked: number;
      created_at: string;
      updated_at: string;
    };

    return this.mapModuleRow(row);
  }

  /**
   * Get all modules.
   */
  getModules(): ModuleRecord[] {
    const stmt = this.db.prepare("SELECT * FROM modules ORDER BY position");
    const rows = stmt.all() as Array<{
      id: number;
      slug: string;
      name: string;
      position: number;
      is_locked: number;
      created_at: string;
      updated_at: string;
    }>;
    return rows.map((row) => this.mapModuleRow(row));
  }

  /**
   * Get module count.
   */
  getModuleCount(): number {
    const stmt = this.db.prepare("SELECT COUNT(*) as count FROM modules");
    const row = stmt.get() as { count: number };
    return row.count;
  }

  /**
   * Get module by slug.
   */
  getModuleBySlug(slug: string): ModuleRecord | null {
    const stmt = this.db.prepare("SELECT * FROM modules WHERE slug = ?");
    const row = stmt.get(slug) as {
      id: number;
      slug: string;
      name: string;
      position: number;
      is_locked: number;
      created_at: string;
      updated_at: string;
    } | undefined;
    return row ? this.mapModuleRow(row) : null;
  }

  private mapModuleRow(row: {
    id: number;
    slug: string;
    name: string;
    position: number;
    is_locked: number;
    created_at: string;
    updated_at: string;
  }): ModuleRecord {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      position: row.position,
      isLocked: row.is_locked === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ============================================
  // Lesson Operations
  // ============================================

  /**
   * Upsert a lesson (insert or update).
   */
  upsertLesson(
    moduleId: number,
    slug: string,
    name: string,
    url: string,
    position: number,
    isLocked = false
  ): LessonRecord {
    const stmt = this.db.prepare(`
      INSERT INTO lessons (module_id, slug, name, url, position, is_locked, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(module_id, slug) DO UPDATE SET
        name = excluded.name,
        url = excluded.url,
        position = excluded.position,
        is_locked = excluded.is_locked,
        updated_at = datetime('now')
      RETURNING *
    `);
    const row = stmt.get(moduleId, slug, name, url, position, isLocked ? 1 : 0) as RawLessonRow;
    return this.mapLessonRow(row);
  }

  /**
   * Update lesson scan results.
   */
  updateLessonScan(
    lessonId: number,
    videoType: VideoTypeValue | null,
    videoUrl: string | null,
    hlsUrl: string | null,
    status: LessonStatusType,
    errorMessage?: string,
    errorCode?: string
  ): void {
    const stmt = this.db.prepare(`
      UPDATE lessons SET
        video_type = ?,
        video_url = ?,
        hls_url = ?,
        status = ?,
        error_message = ?,
        error_code = ?,
        last_scanned_at = datetime('now'),
        updated_at = datetime('now')
      WHERE id = ?
    `);
    stmt.run(videoType, videoUrl, hlsUrl, status, errorMessage ?? null, errorCode ?? null, lessonId);
  }

  /**
   * Mark lesson as downloaded.
   */
  markLessonDownloaded(lessonId: number, fileSize?: number): void {
    const stmt = this.db.prepare(`
      UPDATE lessons SET
        status = 'downloaded',
        last_downloaded_at = datetime('now'),
        video_file_size = ?,
        error_message = NULL,
        error_code = NULL,
        updated_at = datetime('now')
      WHERE id = ?
    `);
    stmt.run(fileSize ?? null, lessonId);
  }

  /**
   * Mark lesson as error.
   */
  markLessonError(lessonId: number, errorMessage: string, errorCode?: string): void {
    const stmt = this.db.prepare(`
      UPDATE lessons SET
        status = 'error',
        error_message = ?,
        error_code = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `);
    stmt.run(errorMessage, errorCode ?? null, lessonId);
  }

  /**
   * Get all lessons.
   */
  getLessons(): LessonRecord[] {
    const stmt = this.db.prepare("SELECT * FROM lessons ORDER BY module_id, position");
    const rows = stmt.all() as RawLessonRow[];
    return rows.map((row) => this.mapLessonRow(row));
  }

  /**
   * Get lessons with module info.
   */
  getLessonsWithModules(): LessonWithModule[] {
    const stmt = this.db.prepare(`
      SELECT
        l.*,
        m.name as module_name,
        m.slug as module_slug,
        m.position as module_position
      FROM lessons l
      JOIN modules m ON l.module_id = m.id
      ORDER BY m.position, l.position
    `);
    const rows = stmt.all() as Array<RawLessonRow & {
      module_name: string;
      module_slug: string;
      module_position: number;
    }>;

    return rows.map((row) => ({
      ...this.mapLessonRow(row),
      moduleName: row.module_name,
      moduleSlug: row.module_slug,
      modulePosition: row.module_position,
    }));
  }

  /**
   * Get lessons by status.
   */
  getLessonsByStatus(status: LessonStatusType): LessonWithModule[] {
    const stmt = this.db.prepare(`
      SELECT
        l.*,
        m.name as module_name,
        m.slug as module_slug,
        m.position as module_position
      FROM lessons l
      JOIN modules m ON l.module_id = m.id
      WHERE l.status = ?
      ORDER BY m.position, l.position
    `);
    const rows = stmt.all(status) as Array<RawLessonRow & {
      module_name: string;
      module_slug: string;
      module_position: number;
    }>;

    return rows.map((row) => ({
      ...this.mapLessonRow(row),
      moduleName: row.module_name,
      moduleSlug: row.module_slug,
      modulePosition: row.module_position,
    }));
  }

  /**
   * Get lessons that need scanning (pending or never scanned).
   */
  getLessonsToScan(): LessonWithModule[] {
    const stmt = this.db.prepare(`
      SELECT
        l.*,
        m.name as module_name,
        m.slug as module_slug,
        m.position as module_position
      FROM lessons l
      JOIN modules m ON l.module_id = m.id
      WHERE (l.status = 'pending' OR l.last_scanned_at IS NULL)
        AND l.is_locked = 0
      ORDER BY m.position, l.position
    `);
    const rows = stmt.all() as Array<RawLessonRow & {
      module_name: string;
      module_slug: string;
      module_position: number;
    }>;

    return rows.map((row) => ({
      ...this.mapLessonRow(row),
      moduleName: row.module_name,
      moduleSlug: row.module_slug,
      modulePosition: row.module_position,
    }));
  }

  /**
   * Get lessons that are ready for download (validated with HLS URL).
   */
  getLessonsToDownload(): LessonWithModule[] {
    const stmt = this.db.prepare(`
      SELECT
        l.*,
        m.name as module_name,
        m.slug as module_slug,
        m.position as module_position
      FROM lessons l
      JOIN modules m ON l.module_id = m.id
      WHERE l.status = 'validated' AND l.hls_url IS NOT NULL
      ORDER BY m.position, l.position
    `);
    const rows = stmt.all() as Array<RawLessonRow & {
      module_name: string;
      module_slug: string;
      module_position: number;
    }>;

    return rows.map((row) => ({
      ...this.mapLessonRow(row),
      moduleName: row.module_name,
      moduleSlug: row.module_slug,
      modulePosition: row.module_position,
    }));
  }

  /**
   * Get lesson count.
   */
  getLessonCount(): number {
    const stmt = this.db.prepare("SELECT COUNT(*) as count FROM lessons");
    const row = stmt.get() as { count: number };
    return row.count;
  }

  /**
   * Get lesson by URL.
   */
  getLessonByUrl(url: string): LessonRecord | null {
    const stmt = this.db.prepare("SELECT * FROM lessons WHERE url = ?");
    const row = stmt.get(url) as RawLessonRow | undefined;
    return row ? this.mapLessonRow(row) : null;
  }

  /**
   * Get status summary.
   */
  getStatusSummary(): Record<LessonStatusType, number> & { locked: number } {
    const stmt = this.db.prepare(`
      SELECT status, COUNT(*) as count FROM lessons GROUP BY status
    `);
    const rows = stmt.all() as Array<{ status: LessonStatusType; count: number }>;

    const summary: Record<LessonStatusType, number> & { locked: number } = {
      pending: 0,
      scanned: 0,
      validated: 0,
      downloaded: 0,
      error: 0,
      skipped: 0,
      locked: 0,
    };

    for (const row of rows) {
      summary[row.status] = row.count;
    }

    // Count locked lessons separately
    const lockedStmt = this.db.prepare(`SELECT COUNT(*) as count FROM lessons WHERE is_locked = 1`);
    const lockedRow = lockedStmt.get() as { count: number };
    summary.locked = lockedRow.count;

    return summary;
  }

  /**
   * Reset all error lessons to pending for retry.
   */
  resetErrorLessons(): number {
    const stmt = this.db.prepare(`
      UPDATE lessons SET
        status = 'pending',
        error_message = NULL,
        error_code = NULL,
        updated_at = datetime('now')
      WHERE status = 'error'
    `);
    const result = stmt.run();
    return result.changes;
  }

  /**
   * Get lessons by error code.
   */
  getLessonsByErrorCode(errorCode: string): LessonWithModule[] {
    const stmt = this.db.prepare(`
      SELECT
        l.*,
        m.name as module_name,
        m.slug as module_slug,
        m.position as module_position
      FROM lessons l
      JOIN modules m ON l.module_id = m.id
      WHERE l.error_code = ?
      ORDER BY m.position, l.position
    `);
    const rows = stmt.all(errorCode) as Array<RawLessonRow & {
      module_name: string;
      module_slug: string;
      module_position: number;
    }>;

    return rows.map((row) => ({
      ...this.mapLessonRow(row),
      moduleName: row.module_name,
      moduleSlug: row.module_slug,
      modulePosition: row.module_position,
    }));
  }

  /**
   * Get count of lessons grouped by video type.
   */
  getVideoTypeSummary(): Record<string, number> {
    const stmt = this.db.prepare(`
      SELECT video_type, COUNT(*) as count
      FROM lessons
      WHERE video_type IS NOT NULL
      GROUP BY video_type
    `);
    const rows = stmt.all() as Array<{ video_type: string; count: number }>;

    const summary: Record<string, number> = {};
    for (const row of rows) {
      summary[row.video_type] = row.count;
    }

    return summary;
  }

  private mapLessonRow(row: RawLessonRow): LessonRecord {
    return {
      id: row.id,
      moduleId: row.module_id,
      slug: row.slug,
      name: row.name,
      url: row.url,
      position: row.position,
      isLocked: row.is_locked === 1,
      status: row.status as LessonStatusType,
      videoType: row.video_type as VideoTypeValue | null,
      videoUrl: row.video_url,
      hlsUrl: row.hls_url,
      errorMessage: row.error_message,
      errorCode: row.error_code,
      lastScannedAt: row.last_scanned_at,
      lastDownloadedAt: row.last_downloaded_at,
      videoFileSize: row.video_file_size,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

/**
 * Raw lesson row from SQLite.
 */
interface RawLessonRow {
  id: number;
  module_id: number;
  slug: string;
  name: string;
  url: string;
  position: number;
  is_locked: number;
  status: string;
  video_type: string | null;
  video_url: string | null;
  hls_url: string | null;
  error_message: string | null;
  error_code: string | null;
  last_scanned_at: string | null;
  last_downloaded_at: string | null;
  video_file_size: number | null;
  created_at: string;
  updated_at: string;
}

