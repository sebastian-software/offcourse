import type { DownloadResult, VideoDownloadTask } from "../downloader/index.js";
import type { SyncPlatform } from "../cli/syncPlatform.js";
import { slugify } from "../shared/slug.js";
import {
  CourseDatabase,
  extractCommunitySlug,
  LessonStatus,
  type LessonRecord,
  type VideoTypeValue,
} from "./database.js";

export interface CourseStateLesson {
  slug: string;
  name: string;
  url: string;
  position: number;
  isLocked?: boolean;
}

export interface CourseStateModule {
  slug: string;
  name: string;
  position: number;
  isLocked?: boolean;
  lessons: CourseStateLesson[];
}

export interface CourseStateStructure {
  name: string;
  url: string;
  modules: CourseStateModule[];
}

export interface InitializeCourseStateOptions {
  force?: boolean;
  retryFailed?: boolean;
  databasePath?: string;
}

export interface InitializedCourseState {
  key: string;
  database: CourseDatabase;
  lessonsByUrl: Map<string, LessonRecord>;
  retryLessonIds: Set<number>;
}

function safeKeyPart(value: string): string {
  return slugify(value) || "course";
}

/** Returns a stable, platform-scoped cache key for a supported course URL. */
export function getCourseStateKey(platform: SyncPlatform, value: string): string {
  if (platform === "skool") return extractCommunitySlug(value);

  const url = new URL(value);
  const parts = url.pathname.split("/").filter(Boolean);

  switch (platform) {
    case "highlevel": {
      const productsIndex = parts.findIndex((part) => part === "products");
      const courseId = productsIndex >= 0 ? parts[productsIndex + 1] : undefined;
      return `highlevel-${safeKeyPart(url.hostname)}-${safeKeyPart(courseId ?? url.pathname)}`;
    }
    case "learningsuite": {
      const courseIndex = parts.findIndex((part) => part === "course");
      const courseId = courseIndex >= 0 ? parts[courseIndex + 2] : undefined;
      return `learningsuite-${safeKeyPart(url.hostname)}-${safeKeyPart(courseId ?? url.pathname)}`;
    }
    case "piccalilli": {
      const lessonsIndex = parts.findIndex((part) => part === "lessons");
      const courseSlug = lessonsIndex > 0 ? parts[lessonsIndex - 1] : undefined;
      return `piccalilli-${safeKeyPart(courseSlug ?? url.pathname)}`;
    }
    case "joshcomeau":
      return `joshcomeau-${safeKeyPart(parts[0] ?? url.pathname)}`;
    default: {
      const unhandledPlatform: never = platform;
      throw new Error(`Unhandled platform: ${String(unhandledPlatform)}`);
    }
  }
}

/** Opens and refreshes the shared course state for any supported platform. */
export function initializeCourseState(
  platform: SyncPlatform,
  sourceUrl: string,
  structure: CourseStateStructure,
  options: InitializeCourseStateOptions = {}
): InitializedCourseState {
  const key = getCourseStateKey(platform, sourceUrl);
  const database = new CourseDatabase(key, options.databasePath);

  try {
    database.withTransaction(() => {
      database.updateCourseMetadata(structure.name, structure.url);

      for (const module of structure.modules) {
        const moduleRecord = database.upsertModule(
          module.slug,
          module.name,
          module.position,
          module.isLocked
        );

        for (const lesson of module.lessons) {
          database.upsertLesson(
            moduleRecord.id,
            lesson.slug,
            lesson.name,
            lesson.url,
            lesson.position,
            lesson.isLocked
          );
        }
      }
    });

    if (options.force) database.resetAllLessonsToPending();
    const retryLessonIds = new Set<number>();
    if (options.retryFailed) {
      for (const lesson of database.getLessonsToRetry(Number.MAX_SAFE_INTEGER)) {
        retryLessonIds.add(lesson.id);
        database.queueForRetry(lesson.id);
      }
    }

    return {
      key,
      database,
      lessonsByUrl: new Map(database.getLessons().map((lesson) => [lesson.url, lesson])),
      retryLessonIds,
    };
  } catch (error) {
    database.close();
    throw error;
  }
}

export function markLessonScanReady(
  database: CourseDatabase,
  lessonId: number,
  task: Pick<VideoDownloadTask, "videoType" | "videoUrl">
): void {
  const supportedTypes = new Set<VideoTypeValue>([
    "loom",
    "vimeo",
    "youtube",
    "wistia",
    "native",
    "unknown",
  ]);
  const videoType =
    task.videoType && supportedTypes.has(task.videoType as VideoTypeValue)
      ? (task.videoType as VideoTypeValue)
      : task.videoType
        ? "native"
        : null;
  let stateUrl: string | null = null;
  try {
    const parsed = new URL(task.videoUrl);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      stateUrl = `${parsed.origin}${parsed.pathname}`;
    }
  } catch {
    // Opaque segment manifests and malformed provider URLs are not safe to persist.
  }
  database.updateLessonScan(lessonId, videoType, stateUrl, null, LessonStatus.VALIDATED);
}

export function markLessonFailure(
  database: CourseDatabase,
  lessonId: number,
  error: unknown,
  errorCode = "SYNC_ERROR"
): void {
  const message = (error instanceof Error ? error.message : String(error)).replace(
    /\b(?:https?:\/\/|segments:)[^\s"'<>]+/gi,
    (url) => {
      if (url.toLowerCase().startsWith("segments:")) return "segments:[redacted]";
      try {
        const parsed = new URL(url);
        return `${parsed.origin}${parsed.pathname}`;
      } catch {
        return "[redacted]";
      }
    }
  );
  database.markLessonError(lessonId, message, errorCode);
  database.incrementRetryCount(lessonId);
}

export function recordVideoDownloadResult(
  database: CourseDatabase,
  task: VideoDownloadTask,
  result: DownloadResult | undefined,
  error?: string
): void {
  if (result?.success) {
    database.markLessonDownloaded(task.lessonId);
    return;
  }

  markLessonFailure(
    database,
    task.lessonId,
    error ?? result?.error ?? "Download failed",
    result?.errorCode ?? "DOWNLOAD_ERROR"
  );
}
