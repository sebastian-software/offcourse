/**
 * Zod schemas for LearningSuite API responses.
 * LearningSuite uses a GraphQL API.
 */

import { z } from "zod";

// ============================================================================
// Tenant Configuration
// ============================================================================

export const TenantConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  subdomain: z.string(),
});

export type TenantConfig = z.infer<typeof TenantConfigSchema>;

// ============================================================================
// Authentication Response
// ============================================================================

export const AuthResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiresIn: z.number().optional(),
});

export type AuthResponse = z.infer<typeof AuthResponseSchema>;

// ============================================================================
// GraphQL Response Wrapper
// ============================================================================

export const GraphQLResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    data: dataSchema.nullable(),
    errors: z
      .array(
        z.object({
          message: z.string(),
          path: z.array(z.string()).optional(),
        })
      )
      .optional(),
  });

// ============================================================================
// Course (Product) Schema
// ============================================================================

export const CourseSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  thumbnailUrl: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  progress: z.number().nullable().optional(),
  moduleCount: z.number().optional(),
  lessonCount: z.number().optional(),
  isPublished: z.boolean().optional(),
});

export type Course = z.infer<typeof CourseSchema>;

export const CoursesResponseSchema = z.object({
  courses: z.array(CourseSchema).optional(),
  products: z.array(CourseSchema).optional(),
});

export type CoursesResponse = z.infer<typeof CoursesResponseSchema>;

// ============================================================================
// Module (Chapter/Section) Schema
// ============================================================================

export const ModuleSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  position: z.number().optional(),
  order: z.number().optional(),
  isLocked: z.boolean().optional(),
  isPublished: z.boolean().optional(),
  lessonCount: z.number().optional(),
});

export type Module = z.infer<typeof ModuleSchema>;

export const ModulesResponseSchema = z.object({
  modules: z.array(ModuleSchema).optional(),
  chapters: z.array(ModuleSchema).optional(),
  sections: z.array(ModuleSchema).optional(),
});

export type ModulesResponse = z.infer<typeof ModulesResponseSchema>;

// ============================================================================
// Lesson (Post) Schema
// ============================================================================

export const LessonSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  position: z.number().optional(),
  order: z.number().optional(),
  isLocked: z.boolean().optional(),
  isPublished: z.boolean().optional(),
  isCompleted: z.boolean().optional(),
  duration: z.number().nullable().optional(),
  videoUrl: z.string().nullable().optional(),
  contentType: z.string().optional(),
});

export type Lesson = z.infer<typeof LessonSchema>;

export const LessonsResponseSchema = z.object({
  lessons: z.array(LessonSchema).optional(),
  posts: z.array(LessonSchema).optional(),
});

export type LessonsResponse = z.infer<typeof LessonsResponseSchema>;

// ============================================================================
// Lesson Content Schema
// ============================================================================

export const VideoAssetSchema = z.object({
  id: z.string().optional(),
  url: z.string().optional(),
  hlsUrl: z.string().optional(),
  thumbnailUrl: z.string().nullable().optional(),
  duration: z.number().nullable().optional(),
  provider: z.string().optional(),
  type: z.string().optional(),
});

export type VideoAsset = z.infer<typeof VideoAssetSchema>;

export const AttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  type: z.string().optional(),
  size: z.number().optional(),
});

export type Attachment = z.infer<typeof AttachmentSchema>;

export const LessonContentSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  htmlContent: z.string().nullable().optional(),
  content: z.string().nullable().optional(),
  video: VideoAssetSchema.nullable().optional(),
  videoUrl: z.string().nullable().optional(),
  attachments: z.array(AttachmentSchema).optional(),
  materials: z.array(AttachmentSchema).optional(),
});

export type LessonContent = z.infer<typeof LessonContentSchema>;

// ============================================================================
// Full Course Structure (for navigation)
// ============================================================================

export const CourseStructureModuleSchema = ModuleSchema.extend({
  lessons: z.array(LessonSchema).optional(),
});

export type CourseStructureModule = z.infer<typeof CourseStructureModuleSchema>;

export const CourseStructureSchema = z.object({
  course: CourseSchema,
  modules: z.array(CourseStructureModuleSchema),
});

export type CourseStructure = z.infer<typeof CourseStructureSchema>;

// ============================================================================
// Helper: Safe parse with logging
// ============================================================================

/**
 * Safely parses data with a Zod schema.
 * Returns the parsed data or null if validation fails.
 */
export function safeParse<T>(schema: z.ZodType<T>, data: unknown, context?: string): T | null {
  const result = schema.safeParse(data);
  if (result.success) {
    return result.data;
  }

  if (context) {
    console.warn(`[${context}] Validation failed:`, z.treeifyError(result.error));
  }

  return null;
}

// ============================================================================
// GraphQL Query Types
// ============================================================================

export interface GraphQLQuery {
  operationName?: string;
  query: string;
  variables?: Record<string, unknown>;
}
