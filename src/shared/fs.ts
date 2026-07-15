/** Thin wrappers around fs/promises for common operations. */
import { mkdir, readFile, writeFile, unlink, access, stat, chmod } from "node:fs/promises";
import { dirname } from "node:path";

export interface FilePermissionsOptions {
  mode?: number;
}

/**
 * Check if a file or directory exists.
 */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 */
export async function ensureDir(dir: string, options: FilePermissionsOptions = {}): Promise<void> {
  await mkdir(dir, { recursive: true, mode: options.mode });

  // mkdir's mode only applies when creating a directory. Tighten an existing
  // directory too when the caller handles sensitive data.
  if (options.mode !== undefined && process.platform !== "win32") {
    await chmod(dir, options.mode);
  }
}

/**
 * Write a file, creating parent directories if needed.
 */
export async function outputFile(
  path: string,
  data: string,
  options: FilePermissionsOptions = {}
): Promise<void> {
  await ensureDir(dirname(path));
  await writeFile(path, data, { encoding: "utf-8", mode: options.mode });

  // writeFile's mode does not update an existing file, so explicitly correct
  // permissions when sensitive content is overwritten.
  if (options.mode !== undefined && process.platform !== "win32") {
    await chmod(path, options.mode);
  }
}

/**
 * Write binary data to a file, creating parent directories if needed.
 */
export async function outputBinaryFile(path: string, data: Uint8Array): Promise<void> {
  await ensureDir(dirname(path));
  await writeFile(path, data);
}

/**
 * Write JSON to a file, creating parent directories if needed.
 */
export async function outputJson(
  path: string,
  data: unknown,
  options: FilePermissionsOptions = {}
): Promise<void> {
  await outputFile(path, JSON.stringify(data, null, 2), options);
}

/**
 * Read and parse a JSON file.
 * Returns null if file doesn't exist or can't be parsed.
 */
export async function readJson<T = unknown>(path: string): Promise<T | null> {
  try {
    const content = await readFile(path, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Remove a file if it exists.
 */
export async function removeFile(path: string): Promise<boolean> {
  try {
    await unlink(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get file size in bytes, or null if file doesn't exist.
 */
export async function getFileSize(path: string): Promise<number | null> {
  try {
    const stats = await stat(path);
    return stats.size;
  } catch {
    return null;
  }
}

// Re-export commonly used fs/promises functions
export { readFile, writeFile, mkdir, unlink, stat } from "node:fs/promises";
