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
 * Gets the base filename for a lesson (without extension).
 * Format: "01-lesson-name"
 */
export function getLessonBasename(lessonIndex: number, lessonName: string): string {
  return createFolderName(lessonIndex, lessonName);
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
 * Videos are stored directly in the module directory with lesson name.
 */
export function getVideoPath(moduleDir: string, lessonIndex: number, lessonName: string): string {
  return join(moduleDir, `${getLessonBasename(lessonIndex, lessonName)}.mp4`);
}

/**
 * Gets the markdown file path for a lesson.
 * Markdown files are stored directly in the module directory with lesson name.
 */
export function getMarkdownPath(moduleDir: string, lessonIndex: number, lessonName: string): string {
  return join(moduleDir, `${getLessonBasename(lessonIndex, lessonName)}.md`);
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
 * Checks if a lesson has been fully synced.
 */
export function isLessonSynced(
  moduleDir: string,
  lessonIndex: number,
  lessonName: string
): { video: boolean; content: boolean } {
  return {
    video: existsSync(getVideoPath(moduleDir, lessonIndex, lessonName)),
    content: existsSync(getMarkdownPath(moduleDir, lessonIndex, lessonName)),
  };
}

