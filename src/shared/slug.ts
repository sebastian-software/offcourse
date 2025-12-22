/**
 * Shared slugification utilities.
 * Uses @sindresorhus/slugify for proper Unicode transliteration.
 */
import slugifyLib from "@sindresorhus/slugify";

/**
 * Creates a filesystem-safe slug from a string.
 * Handles Unicode characters, special symbols, and edge cases.
 */
export function slugify(name: string): string {
  return slugifyLib(name, {
    lowercase: true,
    separator: "-",
  }).substring(0, 100);
}

/**
 * Creates a folder name with zero-padded index prefix.
 * Example: createFolderName(0, "Introduction") → "01-introduction"
 */
export function createFolderName(index: number, name: string): string {
  const prefix = String(index + 1).padStart(2, "0");
  const slug = slugify(name);
  return `${prefix}-${slug}`;
}
