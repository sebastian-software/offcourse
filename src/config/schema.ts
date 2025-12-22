import { z } from "zod";

/**
 * Video quality preferences for downloads.
 */
export const VIDEO_QUALITY = {
  highest: "highest",
  lowest: "lowest",
  "1080p": "1080p",
  "720p": "720p",
  "480p": "480p",
} as const;

export type VideoQuality = keyof typeof VIDEO_QUALITY;

/**
 * Global application configuration schema.
 */
export const configSchema = z.object({
  outputDir: z.string().default("~/Downloads/offcourse"),
  videoQuality: z.enum(["highest", "lowest", "1080p", "720p", "480p"]).default("highest"),
  concurrency: z.number().int().min(1).max(5).default(2),
  retryAttempts: z.number().int().min(0).max(10).default(3),
  headless: z.boolean().default(true),
});

export type Config = z.infer<typeof configSchema>;

/**
 * Course sync state to track progress and enable resume.
 */
export const courseSyncStateSchema = z.object({
  url: z.url(),
  name: z.string(),
  lastSyncedAt: z.iso.datetime().optional(),
  modules: z.array(
    z.object({
      name: z.string(),
      slug: z.string(),
      lessons: z.array(
        z.object({
          name: z.string(),
          slug: z.string(),
          url: z.url(),
          isCompleted: z.boolean().default(false),
          videoDownloaded: z.boolean().default(false),
          contentSaved: z.boolean().default(false),
        })
      ),
    })
  ),
});

export type CourseSyncState = z.infer<typeof courseSyncStateSchema>;

/**
 * Session info for a specific domain.
 */
export const sessionInfoSchema = z.object({
  domain: z.string(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime().optional(),
});

export type SessionInfo = z.infer<typeof sessionInfoSchema>;
