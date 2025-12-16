import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Application directory paths.
 */
export const APP_DIR = join(homedir(), ".course-grab");
export const SESSIONS_DIR = join(APP_DIR, "sessions");
export const CONFIG_FILE = join(APP_DIR, "config.json");

/**
 * Get the session file path for a specific domain.
 */
export function getSessionPath(domain: string): string {
  // Sanitize domain for filesystem
  const safeDomain = domain.replace(/[^a-zA-Z0-9.-]/g, "_");
  return join(SESSIONS_DIR, `${safeDomain}.json`);
}

/**
 * Get the sync state file path for a course.
 */
export function getSyncStatePath(courseSlug: string): string {
  const safeSlug = courseSlug.replace(/[^a-zA-Z0-9-]/g, "_");
  return join(APP_DIR, "sync-state", `${safeSlug}.json`);
}

/**
 * Expand ~ to home directory in paths.
 */
export function expandPath(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

