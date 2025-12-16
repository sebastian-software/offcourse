import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expandPath, getSyncStatePath } from "../config/paths.js";
import type { CourseSyncState } from "../config/schema.js";
import { courseSyncStateSchema } from "../config/schema.js";
import { createFolderName } from "../scraper/navigator.js";

/**
 * Creates the output directory structure for a course.
 */
export function createCourseDirectory(outputBase: string, courseName: string): string {
  const expanded = expandPath(outputBase);
  const courseDir = join(expanded, createFolderName(0, courseName).replace(/^\d+-/, ""));

  if (!existsSync(courseDir)) {
    mkdirSync(courseDir, { recursive: true });
  }

  return courseDir;
}

/**
 * Creates a module directory within a course.
 */
export function createModuleDirectory(
  courseDir: string,
  moduleIndex: number,
  moduleName: string
): string {
  const moduleDir = join(courseDir, createFolderName(moduleIndex, moduleName));

  if (!existsSync(moduleDir)) {
    mkdirSync(moduleDir, { recursive: true });
  }

  return moduleDir;
}

/**
 * Creates a lesson directory within a module.
 */
export function createLessonDirectory(
  moduleDir: string,
  lessonIndex: number,
  lessonName: string
): string {
  const lessonDir = join(moduleDir, createFolderName(lessonIndex, lessonName));

  if (!existsSync(lessonDir)) {
    mkdirSync(lessonDir, { recursive: true });
  }

  return lessonDir;
}

/**
 * Saves markdown content to a file.
 */
export function saveMarkdown(directory: string, filename: string, content: string): string {
  const filePath = join(directory, filename);
  const dir = dirname(filePath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

/**
 * Gets the video file path for a lesson.
 */
export function getVideoPath(lessonDir: string): string {
  return join(lessonDir, "video.mp4");
}

/**
 * Gets the markdown file path for a lesson.
 */
export function getMarkdownPath(lessonDir: string): string {
  return join(lessonDir, "content.md");
}

/**
 * Loads the sync state for a course.
 */
export function loadSyncState(courseSlug: string): CourseSyncState | null {
  const statePath = getSyncStatePath(courseSlug);

  if (!existsSync(statePath)) {
    return null;
  }

  try {
    const raw = readFileSync(statePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return courseSyncStateSchema.parse(parsed);
  } catch {
    return null;
  }
}

/**
 * Saves the sync state for a course.
 */
export function saveSyncState(courseSlug: string, state: CourseSyncState): void {
  const statePath = getSyncStatePath(courseSlug);
  const dir = dirname(statePath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
}

/**
 * Gets the metadata file path for a lesson.
 */
export function getMetadataPath(lessonDir: string): string {
  return join(lessonDir, ".meta.json");
}

export interface LessonMetadata {
  syncedAt: string;
  updatedAt: string | null;
  videoUrl: string | null;
  videoType: string | null;
}

/**
 * Saves lesson metadata for incremental sync detection.
 */
export function saveLessonMetadata(lessonDir: string, meta: LessonMetadata): void {
  const metaPath = getMetadataPath(lessonDir);
  writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");
}

/**
 * Loads lesson metadata.
 */
export function loadLessonMetadata(lessonDir: string): LessonMetadata | null {
  const metaPath = getMetadataPath(lessonDir);

  if (!existsSync(metaPath)) {
    return null;
  }

  try {
    const raw = readFileSync(metaPath, "utf-8");
    return JSON.parse(raw) as LessonMetadata;
  } catch {
    return null;
  }
}

/**
 * Checks if a lesson has been fully synced.
 */
export function isLessonSynced(lessonDir: string): { video: boolean; content: boolean } {
  return {
    video: existsSync(getVideoPath(lessonDir)),
    content: existsSync(getMarkdownPath(lessonDir)),
  };
}

/**
 * Checks if a lesson needs re-sync based on updatedAt.
 */
export function needsResync(lessonDir: string, remoteUpdatedAt: string | null): boolean {
  if (!remoteUpdatedAt) return false;

  const meta = loadLessonMetadata(lessonDir);
  if (!meta?.updatedAt) return true;

  return new Date(remoteUpdatedAt) > new Date(meta.updatedAt);
}

