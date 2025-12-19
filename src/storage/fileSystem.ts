import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
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

/**
 * Downloads a file from a URL to the specified path.
 */
export async function downloadFile(
  url: string,
  outputPath: string
): Promise<{ success: boolean; error?: string }> {
  if (existsSync(outputPath)) {
    return { success: true }; // Already downloaded
  }

  const dir = dirname(outputPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    if (!response.body) {
      return { success: false, error: "No response body" };
    }

    const fileStream = createWriteStream(outputPath);
    await finished(Readable.fromWeb(response.body as import("stream/web").ReadableStream).pipe(fileStream));

    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

