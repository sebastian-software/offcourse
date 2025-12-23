import { describe, expect, it, vi } from "vitest";
import {
  AttachmentSchema,
  AuthResponseSchema,
  CourseSchema,
  CoursesResponseSchema,
  CourseStructureSchema,
  GraphQLResponseSchema,
  LessonContentSchema,
  LessonSchema,
  LessonsResponseSchema,
  ModuleSchema,
  ModulesResponseSchema,
  safeParse,
  TenantConfigSchema,
  VideoAssetSchema,
} from "./schemas.js";
import { z } from "zod";

describe("LearningSuite Schemas", () => {
  describe("TenantConfigSchema", () => {
    it("validates a valid tenant config", () => {
      const data = {
        id: "tenant-123",
        name: "My Tenant",
        subdomain: "mytenant",
      };
      expect(TenantConfigSchema.parse(data)).toEqual(data);
    });

    it("rejects missing fields", () => {
      expect(() => TenantConfigSchema.parse({ id: "123" })).toThrow();
    });
  });

  describe("AuthResponseSchema", () => {
    it("validates minimal auth response", () => {
      const data = { accessToken: "token123" };
      expect(AuthResponseSchema.parse(data)).toEqual(data);
    });

    it("validates full auth response", () => {
      const data = {
        accessToken: "token123",
        refreshToken: "refresh456",
        expiresIn: 3600,
      };
      expect(AuthResponseSchema.parse(data)).toEqual(data);
    });
  });

  describe("GraphQLResponseSchema", () => {
    it("wraps data schema correctly", () => {
      const DataSchema = z.object({ id: z.string() });
      const ResponseSchema = GraphQLResponseSchema(DataSchema);

      const data = { data: { id: "123" } };
      expect(ResponseSchema.parse(data)).toEqual(data);
    });

    it("handles null data", () => {
      const DataSchema = z.object({ id: z.string() });
      const ResponseSchema = GraphQLResponseSchema(DataSchema);

      const data = { data: null };
      expect(ResponseSchema.parse(data)).toEqual(data);
    });

    it("handles errors array", () => {
      const DataSchema = z.object({ id: z.string() });
      const ResponseSchema = GraphQLResponseSchema(DataSchema);

      const data = {
        data: null,
        errors: [{ message: "Something went wrong", path: ["query", "field"] }],
      };
      expect(ResponseSchema.parse(data)).toEqual(data);
    });
  });

  describe("CourseSchema", () => {
    it("validates minimal course", () => {
      const data = { id: "course-1", title: "My Course" };
      expect(CourseSchema.parse(data)).toEqual(data);
    });

    it("validates full course", () => {
      const data = {
        id: "course-1",
        title: "My Course",
        description: "A great course",
        thumbnailUrl: "https://example.com/thumb.jpg",
        imageUrl: "https://example.com/image.jpg",
        progress: 75,
        moduleCount: 10,
        lessonCount: 50,
        isPublished: true,
      };
      expect(CourseSchema.parse(data)).toEqual(data);
    });

    it("handles null optional fields", () => {
      const data = {
        id: "course-1",
        title: "My Course",
        description: null,
        thumbnailUrl: null,
      };
      expect(CourseSchema.parse(data)).toEqual(data);
    });
  });

  describe("CoursesResponseSchema", () => {
    it("validates courses array", () => {
      const data = {
        courses: [
          { id: "1", title: "Course 1" },
          { id: "2", title: "Course 2" },
        ],
      };
      expect(CoursesResponseSchema.parse(data)).toEqual(data);
    });

    it("validates products array (alternative name)", () => {
      const data = {
        products: [{ id: "1", title: "Product 1" }],
      };
      expect(CoursesResponseSchema.parse(data)).toEqual(data);
    });
  });

  describe("ModuleSchema", () => {
    it("validates minimal module", () => {
      const data = { id: "mod-1", title: "Module 1" };
      expect(ModuleSchema.parse(data)).toEqual(data);
    });

    it("validates full module", () => {
      const data = {
        id: "mod-1",
        title: "Module 1",
        description: "First module",
        position: 0,
        order: 1,
        isLocked: false,
        isPublished: true,
        lessonCount: 5,
      };
      expect(ModuleSchema.parse(data)).toEqual(data);
    });
  });

  describe("ModulesResponseSchema", () => {
    it("validates modules array", () => {
      const data = { modules: [{ id: "1", title: "Module 1" }] };
      expect(ModulesResponseSchema.parse(data)).toEqual(data);
    });

    it("validates chapters array (alternative name)", () => {
      const data = { chapters: [{ id: "1", title: "Chapter 1" }] };
      expect(ModulesResponseSchema.parse(data)).toEqual(data);
    });

    it("validates sections array (alternative name)", () => {
      const data = { sections: [{ id: "1", title: "Section 1" }] };
      expect(ModulesResponseSchema.parse(data)).toEqual(data);
    });
  });

  describe("LessonSchema", () => {
    it("validates minimal lesson", () => {
      const data = { id: "lesson-1", title: "Lesson 1" };
      expect(LessonSchema.parse(data)).toEqual(data);
    });

    it("validates full lesson", () => {
      const data = {
        id: "lesson-1",
        title: "Lesson 1",
        description: "Introduction",
        position: 0,
        order: 1,
        isLocked: false,
        isPublished: true,
        isCompleted: true,
        duration: 600,
        videoUrl: "https://example.com/video.mp4",
        contentType: "video",
      };
      expect(LessonSchema.parse(data)).toEqual(data);
    });
  });

  describe("LessonsResponseSchema", () => {
    it("validates lessons array", () => {
      const data = { lessons: [{ id: "1", title: "Lesson 1" }] };
      expect(LessonsResponseSchema.parse(data)).toEqual(data);
    });

    it("validates posts array (alternative name)", () => {
      const data = { posts: [{ id: "1", title: "Post 1" }] };
      expect(LessonsResponseSchema.parse(data)).toEqual(data);
    });
  });

  describe("VideoAssetSchema", () => {
    it("validates video asset", () => {
      const data = {
        id: "video-1",
        url: "https://example.com/video.mp4",
        hlsUrl: "https://example.com/video.m3u8",
        thumbnailUrl: "https://example.com/thumb.jpg",
        duration: 300,
        provider: "bunny",
        type: "hls",
      };
      expect(VideoAssetSchema.parse(data)).toEqual(data);
    });

    it("validates minimal video asset", () => {
      const data = {};
      expect(VideoAssetSchema.parse(data)).toEqual(data);
    });
  });

  describe("AttachmentSchema", () => {
    it("validates attachment", () => {
      const data = {
        id: "att-1",
        name: "document.pdf",
        url: "https://example.com/document.pdf",
        type: "application/pdf",
        size: 1024000,
      };
      expect(AttachmentSchema.parse(data)).toEqual(data);
    });

    it("validates minimal attachment", () => {
      const data = {
        id: "att-1",
        name: "document.pdf",
        url: "https://example.com/document.pdf",
      };
      expect(AttachmentSchema.parse(data)).toEqual(data);
    });
  });

  describe("LessonContentSchema", () => {
    it("validates full lesson content", () => {
      const data = {
        id: "lesson-1",
        title: "Lesson 1",
        description: "Introduction to the topic",
        htmlContent: "<p>Some content</p>",
        content: "Some content",
        video: {
          id: "video-1",
          url: "https://example.com/video.mp4",
        },
        videoUrl: "https://example.com/video.mp4",
        attachments: [
          {
            id: "att-1",
            name: "slides.pdf",
            url: "https://example.com/slides.pdf",
          },
        ],
      };
      expect(LessonContentSchema.parse(data)).toEqual(data);
    });

    it("validates minimal lesson content", () => {
      const data = {
        id: "lesson-1",
        title: "Lesson 1",
      };
      expect(LessonContentSchema.parse(data)).toEqual(data);
    });
  });

  describe("CourseStructureSchema", () => {
    it("validates full course structure", () => {
      const data = {
        course: { id: "course-1", title: "My Course" },
        modules: [
          {
            id: "mod-1",
            title: "Module 1",
            lessons: [
              { id: "lesson-1", title: "Lesson 1" },
              { id: "lesson-2", title: "Lesson 2" },
            ],
          },
          {
            id: "mod-2",
            title: "Module 2",
            lessons: [{ id: "lesson-3", title: "Lesson 3" }],
          },
        ],
      };
      expect(CourseStructureSchema.parse(data)).toEqual(data);
    });
  });

  describe("safeParse", () => {
    it("returns parsed data on success", () => {
      const schema = z.object({ name: z.string() });
      const result = safeParse(schema, { name: "test" });
      expect(result).toEqual({ name: "test" });
    });

    it("returns null on failure", () => {
      const schema = z.object({ name: z.string() });
      const result = safeParse(schema, { name: 123 });
      expect(result).toBeNull();
    });

    it("logs context on failure when provided", () => {
      const schema = z.object({ name: z.string() });
      const calls: unknown[][] = [];
      const warnSpy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
        calls.push(args);
      });

      safeParse(schema, { name: 123 }, "TestContext");

      expect(warnSpy).toHaveBeenCalled();
      expect(calls.length).toBeGreaterThan(0);
      expect(String(calls[0]?.[0])).toContain("TestContext");

      warnSpy.mockRestore();
    });
  });
});
