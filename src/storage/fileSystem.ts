import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { expandPath, getSyncStatePath } from "../config/paths.js";
import type { CourseSyncState } from "../config/schema.js";
import { courseSyncStateSchema } from "../config/schema.js";
import { createFolderName } from "../scraper/navigator.js";
import { ensureDir, outputFile, pathExists, readJson, outputJson } from "../shared/fs.js";
import { http } from "../shared/http.js";

// ============================================
// Pure functions - testable without mocking
// ============================================

/**
 * Gets the base filename for a lesson (without extension).
 * Format: "01-lesson-name"
 */
export function getLessonBasename(lessonIndex: number, lessonName: string): string {
  return createFolderName(lessonIndex, lessonName);
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
export function getMarkdownPath(
  moduleDir: string,
  lessonIndex: number,
  lessonName: string
): string {
  return join(moduleDir, `${getLessonBasename(lessonIndex, lessonName)}.md`);
}

/**
 * Gets the path for a downloadable file.
 * Files are stored in the module directory with lesson prefix.
 */
export function getDownloadFilePath(
  moduleDir: string,
  lessonIndex: number,
  lessonName: string,
  filename: string
): string {
  const lessonPrefix = getLessonBasename(lessonIndex, lessonName);
  // Sanitize filename
  const safeFilename = filename.replace(/[<>:"/\\|?*]/g, "_");
  return join(moduleDir, `${lessonPrefix}-${safeFilename}`);
}

// ============================================
// I/O functions - require filesystem access
// ============================================
/* v8 ignore start */

/**
 * Creates the output directory structure for a course.
 */
export async function createCourseDirectory(
  outputBase: string,
  courseName: string
): Promise<string> {
  const expanded = expandPath(outputBase);
  const courseDir = join(expanded, createFolderName(0, courseName).replace(/^\d+-/, ""));
  await ensureDir(courseDir);
  return courseDir;
}

/**
 * Creates a module directory within a course.
 */
export async function createModuleDirectory(
  courseDir: string,
  moduleIndex: number,
  moduleName: string
): Promise<string> {
  const moduleDir = join(courseDir, createFolderName(moduleIndex, moduleName));
  await ensureDir(moduleDir);
  return moduleDir;
}

/**
 * Saves markdown content to a file.
 */
export async function saveMarkdown(
  directory: string,
  filename: string,
  content: string
): Promise<string> {
  const filePath = join(directory, filename);
  await outputFile(filePath, content);
  return filePath;
}

/**
 * Loads the sync state for a course.
 */
export async function loadSyncState(courseSlug: string): Promise<CourseSyncState | null> {
  const statePath = getSyncStatePath(courseSlug);
  const data = await readJson(statePath);

  if (!data) {
    return null;
  }

  try {
    return courseSyncStateSchema.parse(data);
  } catch {
    return null;
  }
}

/**
 * Saves the sync state for a course.
 */
export async function saveSyncState(courseSlug: string, state: CourseSyncState): Promise<void> {
  const statePath = getSyncStatePath(courseSlug);
  await outputJson(statePath, state);
}

/**
 * Checks if a lesson has been fully synced.
 */
export async function isLessonSynced(
  moduleDir: string,
  lessonIndex: number,
  lessonName: string
): Promise<{ video: boolean; content: boolean }> {
  const [video, content] = await Promise.all([
    pathExists(getVideoPath(moduleDir, lessonIndex, lessonName)),
    pathExists(getMarkdownPath(moduleDir, lessonIndex, lessonName)),
  ]);
  return { video, content };
}

/**
 * Downloads a file from a URL to the specified path.
 */
export async function downloadFile(
  url: string,
  outputPath: string
): Promise<{ success: boolean; error?: string }> {
  if (await pathExists(outputPath)) {
    return { success: true }; // Already downloaded
  }

  await ensureDir(join(outputPath, ".."));

  try {
    const response = await http.get(url);
    const body = response.body;

    if (!body) {
      return { success: false, error: "No response body" };
    }

    const fileStream = createWriteStream(outputPath);
    await pipeline(Readable.fromWeb(body as import("stream/web").ReadableStream), fileStream);

    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/* v8 ignore stop */
