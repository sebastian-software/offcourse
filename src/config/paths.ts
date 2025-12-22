import { homedir } from "node:os";
import { join } from "node:path";
import untildify from "untildify";

/**
 * Application directory paths.
 * Uses ~/.offcourse/ for easy access and visibility.
 */
export const APP_DIR = join(homedir(), ".offcourse");
export const SESSIONS_DIR = join(APP_DIR, "sessions");
export const CONFIG_FILE = join(APP_DIR, "config.json");
export const CACHE_DIR = join(APP_DIR, "cache");

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
  return untildify(path);
}
