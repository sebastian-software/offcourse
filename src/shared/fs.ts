import { mkdir, readFile, writeFile, unlink, access, stat } from "node:fs/promises";
import { dirname } from "node:path";

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
export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

/**
 * Write a file, creating parent directories if needed.
 */
export async function outputFile(path: string, data: string): Promise<void> {
  await ensureDir(dirname(path));
  await writeFile(path, data, "utf-8");
}

/**
 * Write JSON to a file, creating parent directories if needed.
 */
export async function outputJson(path: string, data: unknown): Promise<void> {
  await outputFile(path, JSON.stringify(data, null, 2));
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
