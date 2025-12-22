/**
 * Zod schemas for Skool/Next.js __NEXT_DATA__ responses.
 * These validate only the fields we actually use, ignoring everything else.
 */

import { z } from "zod";

// ============================================================================
// Skool Course Child (Module/Lesson)
// ============================================================================

const CourseMetadataSchema = z
  .object({
    title: z.string().optional(),
    videoLink: z.string().optional(),
  })
  .passthrough();

const CourseInfoSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(), // 8-char hex slug
    metadata: CourseMetadataSchema.optional(),
  })
  .passthrough();

const CourseChildSchema = z
  .object({
    course: CourseInfoSchema.optional(),
    hasAccess: z.boolean().optional(),
  })
  .passthrough();

// ============================================================================
// Skool __NEXT_DATA__ PageProps
// ============================================================================

const SkoolCourseSchema = z
  .object({
    children: z.array(CourseChildSchema).optional(),
  })
  .passthrough();

const SkoolPagePropsSchema = z
  .object({
    course: SkoolCourseSchema.optional(),
    selectedModule: z.string().optional(),
  })
  .passthrough();

export const SkoolNextDataSchema = z
  .object({
    props: z
      .object({
        pageProps: SkoolPagePropsSchema.optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type SkoolNextData = z.infer<typeof SkoolNextDataSchema>;

// ============================================================================
// Extracted Types (clean types for use in the app)
// ============================================================================

export interface SkoolModule {
  slug: string; // 8-char hex
  title: string;
  hasAccess: boolean;
}

export interface SkoolLesson {
  id: string;
  hasAccess: boolean;
}

export interface SkoolVideoInfo {
  url: string;
  type: "loom" | "vimeo" | "youtube" | "wistia" | "unknown";
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Safely parses __NEXT_DATA__ JSON from a script element.
 * Returns null if parsing fails.
 */
export function parseNextData(json: string): SkoolNextData | null {
  try {
    const data = JSON.parse(json);
    const result = SkoolNextDataSchema.safeParse(data);
    if (result.success) {
      return result.data;
    }
    console.warn("[parseNextData] Validation failed:", result.error.format());
    return null;
  } catch {
    return null;
  }
}

/**
 * Extracts modules from parsed __NEXT_DATA__.
 */
export function extractModulesFromNextData(data: SkoolNextData): SkoolModule[] {
  const children = data.props?.pageProps?.course?.children;
  if (!Array.isArray(children)) return [];

  const modules: SkoolModule[] = [];
  const seen = new Set<string>();

  for (const child of children) {
    const course = child.course;
    if (!course?.name) continue;

    // Skool module slugs are 8-char hex strings
    if (!/^[a-f0-9]{8}$/.test(course.name)) continue;

    if (seen.has(course.name)) continue;
    seen.add(course.name);

    modules.push({
      slug: course.name,
      title: course.metadata?.title ?? `Module ${modules.length + 1}`,
      hasAccess: child.hasAccess !== false,
    });
  }

  return modules;
}

/**
 * Extracts lesson access info from parsed __NEXT_DATA__.
 */
export function extractLessonAccessFromNextData(data: SkoolNextData): Map<string, boolean> {
  const accessMap = new Map<string, boolean>();
  const children = data.props?.pageProps?.course?.children;

  if (!Array.isArray(children)) return accessMap;

  for (const child of children) {
    const id = child.course?.id;
    const hasAccess = child.hasAccess;
    if (id && typeof hasAccess === "boolean") {
      accessMap.set(id, hasAccess);
    }
  }

  return accessMap;
}

/**
 * Extracts video URL from parsed __NEXT_DATA__ for a specific module.
 */
export function extractVideoFromNextData(
  data: SkoolNextData,
  selectedModuleId: string
): SkoolVideoInfo | null {
  const children = data.props?.pageProps?.course?.children;
  if (!Array.isArray(children)) return null;

  for (const child of children) {
    if (child.course?.id === selectedModuleId) {
      const videoLink = child.course.metadata?.videoLink;
      if (!videoLink) return null;

      // Determine video type
      if (videoLink.includes("loom.com")) {
        const embedUrl = videoLink.replace("/share/", "/embed/").split("?")[0];
        return { url: embedUrl ?? videoLink, type: "loom" };
      }
      if (videoLink.includes("vimeo.com")) {
        return { url: videoLink, type: "vimeo" };
      }
      if (videoLink.includes("youtube.com") || videoLink.includes("youtu.be")) {
        return { url: videoLink, type: "youtube" };
      }
      if (videoLink.includes("wistia")) {
        return { url: videoLink, type: "wistia" };
      }
      return { url: videoLink, type: "unknown" };
    }
  }

  return null;
}
