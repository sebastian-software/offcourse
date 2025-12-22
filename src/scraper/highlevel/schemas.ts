/**
 * Zod schemas for HighLevel API responses.
 * These provide runtime validation and type inference.
 */

import { z } from "zod";

// Re-export Firebase auth types (Firebase is used by HighLevel for auth)
export {
  FirebaseAuthTokenSchema,
  type FirebaseAuthToken,
  type FirebaseAuthRaw,
} from "../../shared/firebase.js";

// ============================================================================
// Portal Settings API
// ============================================================================

export const PortalSettingsResponseSchema = z.object({
  locationId: z.string(),
  portalName: z.string().optional(),
  name: z.string().optional(),
});

export type PortalSettingsResponse = z.infer<typeof PortalSettingsResponseSchema>;

// ============================================================================
// Video License API
// ============================================================================

export const VideoLicenseResponseSchema = z.object({
  url: z.string(),
  token: z.string(),
});

export type VideoLicenseResponse = z.infer<typeof VideoLicenseResponseSchema>;

// ============================================================================
// Post Details API
// ============================================================================

const VideoAssetSchema = z.object({
  id: z.string().optional(),
  assetId: z.string().optional(),
  assetsLicenseId: z.string().optional(),
  url: z.string().optional(),
});

const PosterImageSchema = z.object({
  assetId: z.string().optional(),
  url: z.string().optional(),
});

const ContentBlockSchema = z.object({
  type: z.string(),
  id: z.string().optional(),
  assetId: z.string().optional(),
  assetsLicenseId: z.string().optional(),
  url: z.string().optional(),
});

const MaterialSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  url: z.string().optional(),
  type: z.string().optional(),
});

export const PostDetailsSchema = z.object({
  title: z.string().optional(),
  description: z.string().nullable().optional(),
  video: VideoAssetSchema.nullable().optional(),
  posterImage: PosterImageSchema.nullable().optional(),
  contentBlock: z.array(ContentBlockSchema).optional(),
  materials: z.array(MaterialSchema).optional(),
  post_materials: z.array(MaterialSchema).optional(),
});

// Response can have data directly or wrapped in "post"
export const PostDetailsResponseSchema = z.object({
  post: PostDetailsSchema.optional(),
  // Also allow all post fields directly on root
  title: z.string().optional(),
  description: z.string().nullable().optional(),
  video: VideoAssetSchema.nullable().optional(),
  posterImage: PosterImageSchema.nullable().optional(),
  contentBlock: z.array(ContentBlockSchema).optional(),
  materials: z.array(MaterialSchema).optional(),
  post_materials: z.array(MaterialSchema).optional(),
});

export type PostDetailsResponse = z.infer<typeof PostDetailsResponseSchema>;

// ============================================================================
// Categories API
// ============================================================================

export const CategorySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  position: z.number().optional(),
  postCount: z.number().optional(),
  visibility: z.string().optional(),
});

export const CategoriesResponseSchema = z.object({
  categories: z.array(CategorySchema),
});

export type CategoriesResponse = z.infer<typeof CategoriesResponseSchema>;
export type Category = z.infer<typeof CategorySchema>;

// ============================================================================
// Posts (Lessons) API
// ============================================================================

export const PostSchema = z.object({
  id: z.string(),
  title: z.string(),
  indexPosition: z.number().optional(),
  visibility: z.string().optional(),
});

export const PostsResponseSchema = z.object({
  category: z
    .object({
      posts: z.array(PostSchema),
    })
    .optional(),
});

export type PostsResponse = z.infer<typeof PostsResponseSchema>;
export type Post = z.infer<typeof PostSchema>;

// ============================================================================
// Product (Course) API
// ============================================================================

export const ProductSchema = z.object({
  id: z.string().optional(),
  title: z.string(),
  description: z.string().optional(),
  posterImage: z.string().nullable().optional(),
  instructor: z.string().nullable().optional(),
  postCount: z.number().optional(),
});

export const ProductResponseSchema = z.object({
  product: ProductSchema.optional(),
  // Also allow fields directly on root
  id: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  posterImage: z.string().nullable().optional(),
  instructor: z.string().nullable().optional(),
  postCount: z.number().optional(),
});

export type ProductResponse = z.infer<typeof ProductResponseSchema>;
export type Product = z.infer<typeof ProductSchema>;

// ============================================================================
// Helper: Safe parse with logging
// ============================================================================

/**
 * Safely parses data with a Zod schema.
 * Returns the parsed data or null if validation fails.
 * Logs validation errors for debugging.
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
