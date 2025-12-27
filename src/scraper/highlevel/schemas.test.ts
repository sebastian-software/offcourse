/**
 * Tests for HighLevel API schema validation and helper functions.
 */

import { describe, expect, it, vi } from "vitest";
import {
  PortalSettingsResponseSchema,
  VideoLicenseResponseSchema,
  PostDetailsSchema,
  PostDetailsResponseSchema,
  CategorySchema,
  CategoriesResponseSchema,
  PostSchema,
  PostsResponseSchema,
  ProductSchema,
  ProductResponseSchema,
  safeParse,
} from "./schemas.js";
import { z } from "zod";

describe("PortalSettingsResponseSchema", () => {
  it("validates complete portal settings", () => {
    const data = {
      locationId: "loc-123",
      portalName: "My Course Portal",
      name: "Test Name",
    };

    const result = PortalSettingsResponseSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.locationId).toBe("loc-123");
    }
  });

  it("requires locationId", () => {
    const data = {
      portalName: "My Portal",
    };

    const result = PortalSettingsResponseSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("accepts optional fields as undefined", () => {
    const data = {
      locationId: "loc-123",
    };

    const result = PortalSettingsResponseSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.portalName).toBeUndefined();
    }
  });
});

describe("VideoLicenseResponseSchema", () => {
  it("validates complete video license response", () => {
    const data = {
      url: "https://cdn.example.com/video.m3u8",
      token: "abc123token",
    };

    const result = VideoLicenseResponseSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.url).toBe("https://cdn.example.com/video.m3u8");
      expect(result.data.token).toBe("abc123token");
    }
  });

  it("requires both url and token", () => {
    const dataWithoutUrl = { token: "abc" };
    const dataWithoutToken = { url: "https://example.com" };

    expect(VideoLicenseResponseSchema.safeParse(dataWithoutUrl).success).toBe(false);
    expect(VideoLicenseResponseSchema.safeParse(dataWithoutToken).success).toBe(false);
  });
});

describe("PostDetailsSchema", () => {
  it("validates complete post details", () => {
    const data = {
      title: "Lesson 1: Introduction",
      description: "Learn the basics",
      video: {
        id: "vid-1",
        assetId: "asset-1",
        url: "https://cdn.example.com/video.mp4",
      },
      posterImage: {
        assetId: "poster-1",
        url: "https://cdn.example.com/poster.jpg",
      },
      contentBlock: [
        { type: "video", id: "block-1" },
        { type: "text", id: "block-2" },
      ],
      materials: [
        { id: "mat-1", name: "PDF Guide", url: "https://example.com/guide.pdf", type: "pdf" },
      ],
    };

    const result = PostDetailsSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("Lesson 1: Introduction");
      expect(result.data.contentBlock).toHaveLength(2);
    }
  });

  it("accepts null values for nullable fields", () => {
    const data = {
      title: "Test",
      description: null,
      video: null,
      posterImage: null,
    };

    const result = PostDetailsSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBeNull();
      expect(result.data.video).toBeNull();
    }
  });

  it("accepts empty object", () => {
    const result = PostDetailsSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("PostDetailsResponseSchema", () => {
  it("validates response with nested post object", () => {
    const data = {
      post: {
        title: "Lesson Title",
        video: { url: "https://example.com/video.mp4" },
      },
    };

    const result = PostDetailsResponseSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.post?.title).toBe("Lesson Title");
    }
  });

  it("validates response with fields directly on root", () => {
    const data = {
      title: "Direct Title",
      video: { url: "https://example.com/video.mp4" },
    };

    const result = PostDetailsResponseSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("Direct Title");
    }
  });
});

describe("CategorySchema", () => {
  it("validates complete category", () => {
    const data = {
      id: "cat-123",
      title: "Getting Started",
      description: "Introduction to the course",
      position: 0,
      postCount: 5,
      visibility: "public",
    };

    const result = CategorySchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it("requires id and title", () => {
    expect(CategorySchema.safeParse({ id: "cat-1" }).success).toBe(false);
    expect(CategorySchema.safeParse({ title: "Test" }).success).toBe(false);
    expect(CategorySchema.safeParse({ id: "cat-1", title: "Test" }).success).toBe(true);
  });

  it("accepts null description", () => {
    const data = {
      id: "cat-1",
      title: "Test",
      description: null,
    };

    const result = CategorySchema.safeParse(data);
    expect(result.success).toBe(true);
  });
});

describe("CategoriesResponseSchema", () => {
  it("validates categories array", () => {
    const data = {
      categories: [
        { id: "cat-1", title: "Module 1" },
        { id: "cat-2", title: "Module 2" },
      ],
    };

    const result = CategoriesResponseSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.categories).toHaveLength(2);
    }
  });

  it("requires categories array", () => {
    expect(CategoriesResponseSchema.safeParse({}).success).toBe(false);
    expect(CategoriesResponseSchema.safeParse({ categories: [] }).success).toBe(true);
  });
});

describe("PostSchema", () => {
  it("validates complete post", () => {
    const data = {
      id: "post-123",
      title: "Lesson 1",
      indexPosition: 0,
      visibility: "public",
    };

    const result = PostSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it("requires id and title", () => {
    expect(PostSchema.safeParse({ id: "1" }).success).toBe(false);
    expect(PostSchema.safeParse({ title: "Test" }).success).toBe(false);
    expect(PostSchema.safeParse({ id: "1", title: "Test" }).success).toBe(true);
  });
});

describe("PostsResponseSchema", () => {
  it("validates posts response with category wrapper", () => {
    const data = {
      category: {
        posts: [
          { id: "post-1", title: "Lesson 1" },
          { id: "post-2", title: "Lesson 2" },
        ],
      },
    };

    const result = PostsResponseSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.category?.posts).toHaveLength(2);
    }
  });

  it("accepts empty object (no category)", () => {
    const result = PostsResponseSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("ProductSchema", () => {
  it("validates complete product", () => {
    const data = {
      id: "prod-123",
      title: "Complete Course",
      description: "Learn everything",
      posterImage: "https://example.com/poster.jpg",
      instructor: "John Doe",
      postCount: 25,
    };

    const result = ProductSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it("requires title", () => {
    expect(ProductSchema.safeParse({ id: "prod-1" }).success).toBe(false);
    expect(ProductSchema.safeParse({ title: "Test" }).success).toBe(true);
  });

  it("accepts null values for nullable fields", () => {
    const data = {
      title: "Test",
      posterImage: null,
      instructor: null,
    };

    const result = ProductSchema.safeParse(data);
    expect(result.success).toBe(true);
  });
});

describe("ProductResponseSchema", () => {
  it("validates response with nested product", () => {
    const data = {
      product: {
        title: "Course Title",
        description: "Description",
      },
    };

    const result = ProductResponseSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.product?.title).toBe("Course Title");
    }
  });

  it("validates response with fields on root", () => {
    const data = {
      title: "Direct Course Title",
      description: "Direct Description",
    };

    const result = ProductResponseSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("Direct Course Title");
    }
  });
});

describe("safeParse", () => {
  const TestSchema = z.object({
    name: z.string(),
    age: z.number(),
  });

  it("returns parsed data for valid input", () => {
    const data = { name: "John", age: 30 };
    const result = safeParse(TestSchema, data);

    expect(result).toEqual({ name: "John", age: 30 });
  });

  it("returns null for invalid input", () => {
    const data = { name: 123, age: "not a number" };
    const result = safeParse(TestSchema, data);

    expect(result).toBeNull();
  });

  it("logs warning with context when validation fails", () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const data = { name: "John" }; // missing age
    safeParse(TestSchema, data, "TestContext");

    expect(consoleWarn).toHaveBeenCalled();
    expect(consoleWarn.mock.calls[0]?.[0]).toContain("[TestContext]");

    consoleWarn.mockRestore();
  });

  it("does not log when context is not provided", () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const data = { name: "John" }; // missing age
    safeParse(TestSchema, data);

    expect(consoleWarn).not.toHaveBeenCalled();

    consoleWarn.mockRestore();
  });

  it("returns null for undefined/null input", () => {
    expect(safeParse(TestSchema, undefined)).toBeNull();
    expect(safeParse(TestSchema, null)).toBeNull();
  });

  it("handles complex nested schemas", () => {
    const ComplexSchema = z.object({
      user: z.object({
        name: z.string(),
        settings: z.object({
          theme: z.string().optional(),
        }),
      }),
    });

    const validData = {
      user: {
        name: "Alice",
        settings: { theme: "dark" },
      },
    };

    const invalidData = {
      user: {
        name: 123,
        settings: {},
      },
    };

    expect(safeParse(ComplexSchema, validData)).toEqual(validData);
    expect(safeParse(ComplexSchema, invalidData)).toBeNull();
  });
});
