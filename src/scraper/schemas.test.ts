/**
 * Tests for Skool __NEXT_DATA__ parsing and helper functions.
 */

import { describe, expect, it } from "vitest";
import {
  parseNextData,
  extractModulesFromNextData,
  extractLessonAccessFromNextData,
  extractVideoFromNextData,
  SkoolNextDataSchema,
  type SkoolNextData,
} from "./schemas.js";

describe("SkoolNextDataSchema", () => {
  it("validates a complete __NEXT_DATA__ structure", () => {
    const data = {
      props: {
        pageProps: {
          course: {
            children: [
              {
                course: {
                  id: "course-123",
                  name: "abc12345",
                  metadata: {
                    title: "Introduction",
                    videoLink: "https://loom.com/share/abc123",
                  },
                },
                hasAccess: true,
              },
            ],
          },
          selectedModule: "abc12345",
        },
      },
    };

    const result = SkoolNextDataSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.props?.pageProps?.course?.children).toHaveLength(1);
    }
  });

  it("accepts empty/minimal data", () => {
    const result = SkoolNextDataSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts nested empty objects", () => {
    const result = SkoolNextDataSchema.safeParse({
      props: { pageProps: { course: { children: [] } } },
    });
    expect(result.success).toBe(true);
  });
});

describe("parseNextData", () => {
  it("parses valid JSON correctly", () => {
    const json = JSON.stringify({
      props: {
        pageProps: {
          course: {
            children: [
              {
                course: { id: "123", name: "abc12345" },
                hasAccess: true,
              },
            ],
          },
        },
      },
    });

    const result = parseNextData(json);
    expect(result).not.toBeNull();
    expect(result?.props?.pageProps?.course?.children).toHaveLength(1);
  });

  it("returns null for invalid JSON", () => {
    const result = parseNextData("not valid json {{{");
    expect(result).toBeNull();
  });

  it("returns null for empty string", () => {
    const result = parseNextData("");
    expect(result).toBeNull();
  });

  it("returns parsed data for empty object JSON", () => {
    const result = parseNextData("{}");
    expect(result).not.toBeNull();
    expect(result).toEqual({});
  });

  it("handles nested structure with missing properties", () => {
    const json = JSON.stringify({
      props: {
        pageProps: {},
      },
    });

    const result = parseNextData(json);
    expect(result).not.toBeNull();
    expect(result?.props?.pageProps?.course).toBeUndefined();
  });
});

describe("extractModulesFromNextData", () => {
  it("extracts modules with valid 8-char hex slugs", () => {
    const data: SkoolNextData = {
      props: {
        pageProps: {
          course: {
            children: [
              {
                course: {
                  id: "123",
                  name: "a1b2c3d4",
                  metadata: { title: "Module 1" },
                },
                hasAccess: true,
              },
              {
                course: {
                  id: "456",
                  name: "e5f6a7b8",
                  metadata: { title: "Module 2" },
                },
                hasAccess: false,
              },
            ],
          },
        },
      },
    };

    const modules = extractModulesFromNextData(data);
    expect(modules).toHaveLength(2);
    expect(modules[0]).toEqual({
      slug: "a1b2c3d4",
      title: "Module 1",
      hasAccess: true,
    });
    expect(modules[1]).toEqual({
      slug: "e5f6a7b8",
      title: "Module 2",
      hasAccess: false,
    });
  });

  it("filters out non-hex slugs", () => {
    const data: SkoolNextData = {
      props: {
        pageProps: {
          course: {
            children: [
              {
                course: { id: "1", name: "a1b2c3d4" }, // valid hex
                hasAccess: true,
              },
              {
                course: { id: "2", name: "not-a-hex-slug" }, // invalid
                hasAccess: true,
              },
              {
                course: { id: "3", name: "abcdefgh" }, // has 'g' and 'h', not hex
                hasAccess: true,
              },
              {
                course: { id: "4", name: "1234567" }, // only 7 chars
                hasAccess: true,
              },
            ],
          },
        },
      },
    };

    const modules = extractModulesFromNextData(data);
    expect(modules).toHaveLength(1);
    expect(modules[0]?.slug).toBe("a1b2c3d4");
  });

  it("deduplicates modules by slug", () => {
    const data: SkoolNextData = {
      props: {
        pageProps: {
          course: {
            children: [
              {
                course: { id: "1", name: "a1b2c3d4", metadata: { title: "First" } },
                hasAccess: true,
              },
              {
                course: { id: "2", name: "a1b2c3d4", metadata: { title: "Duplicate" } },
                hasAccess: true,
              },
            ],
          },
        },
      },
    };

    const modules = extractModulesFromNextData(data);
    expect(modules).toHaveLength(1);
    expect(modules[0]?.title).toBe("First");
  });

  it("uses fallback title when metadata.title is missing", () => {
    const data: SkoolNextData = {
      props: {
        pageProps: {
          course: {
            children: [
              {
                course: { id: "1", name: "a1b2c3d4" },
                hasAccess: true,
              },
            ],
          },
        },
      },
    };

    const modules = extractModulesFromNextData(data);
    expect(modules[0]?.title).toBe("Module 1");
  });

  it("returns empty array for missing children", () => {
    const data: SkoolNextData = { props: { pageProps: { course: {} } } };
    expect(extractModulesFromNextData(data)).toEqual([]);
  });

  it("returns empty array for null children", () => {
    const data: SkoolNextData = {
      props: { pageProps: { course: { children: undefined } } },
    };
    expect(extractModulesFromNextData(data)).toEqual([]);
  });

  it("returns empty array for empty data", () => {
    expect(extractModulesFromNextData({})).toEqual([]);
  });

  it("treats missing hasAccess as true", () => {
    const data: SkoolNextData = {
      props: {
        pageProps: {
          course: {
            children: [
              {
                course: { id: "1", name: "a1b2c3d4" },
                // hasAccess not specified
              },
            ],
          },
        },
      },
    };

    const modules = extractModulesFromNextData(data);
    expect(modules[0]?.hasAccess).toBe(true);
  });
});

describe("extractLessonAccessFromNextData", () => {
  it("extracts access map from children", () => {
    const data: SkoolNextData = {
      props: {
        pageProps: {
          course: {
            children: [
              { course: { id: "lesson-1" }, hasAccess: true },
              { course: { id: "lesson-2" }, hasAccess: false },
              { course: { id: "lesson-3" }, hasAccess: true },
            ],
          },
        },
      },
    };

    const accessMap = extractLessonAccessFromNextData(data);
    expect(accessMap.size).toBe(3);
    expect(accessMap.get("lesson-1")).toBe(true);
    expect(accessMap.get("lesson-2")).toBe(false);
    expect(accessMap.get("lesson-3")).toBe(true);
  });

  it("skips entries without id", () => {
    const data: SkoolNextData = {
      props: {
        pageProps: {
          course: {
            children: [
              { course: { id: "lesson-1" }, hasAccess: true },
              { course: {}, hasAccess: false },
            ],
          },
        },
      },
    };

    const accessMap = extractLessonAccessFromNextData(data);
    expect(accessMap.size).toBe(1);
    expect(accessMap.has("lesson-1")).toBe(true);
  });

  it("skips entries with non-boolean hasAccess", () => {
    const data: SkoolNextData = {
      props: {
        pageProps: {
          course: {
            children: [
              { course: { id: "lesson-1" }, hasAccess: true },
              { course: { id: "lesson-2" } }, // hasAccess undefined
            ],
          },
        },
      },
    };

    const accessMap = extractLessonAccessFromNextData(data);
    expect(accessMap.size).toBe(1);
  });

  it("returns empty map for missing children", () => {
    expect(extractLessonAccessFromNextData({})).toEqual(new Map());
  });
});

describe("extractVideoFromNextData", () => {
  it("extracts Loom video with embed URL conversion", () => {
    const data: SkoolNextData = {
      props: {
        pageProps: {
          course: {
            children: [
              {
                course: {
                  id: "module-1",
                  metadata: {
                    videoLink: "https://loom.com/share/abc123?something=value",
                  },
                },
              },
            ],
          },
        },
      },
    };

    const video = extractVideoFromNextData(data, "module-1");
    expect(video).toEqual({
      url: "https://loom.com/embed/abc123",
      type: "loom",
    });
  });

  it("extracts Vimeo video", () => {
    const data: SkoolNextData = {
      props: {
        pageProps: {
          course: {
            children: [
              {
                course: {
                  id: "module-1",
                  metadata: { videoLink: "https://vimeo.com/123456789" },
                },
              },
            ],
          },
        },
      },
    };

    const video = extractVideoFromNextData(data, "module-1");
    expect(video).toEqual({
      url: "https://vimeo.com/123456789",
      type: "vimeo",
    });
  });

  it("extracts YouTube video (youtube.com)", () => {
    const data: SkoolNextData = {
      props: {
        pageProps: {
          course: {
            children: [
              {
                course: {
                  id: "module-1",
                  metadata: { videoLink: "https://youtube.com/watch?v=abc123" },
                },
              },
            ],
          },
        },
      },
    };

    const video = extractVideoFromNextData(data, "module-1");
    expect(video).toEqual({
      url: "https://youtube.com/watch?v=abc123",
      type: "youtube",
    });
  });

  it("extracts YouTube video (youtu.be)", () => {
    const data: SkoolNextData = {
      props: {
        pageProps: {
          course: {
            children: [
              {
                course: {
                  id: "module-1",
                  metadata: { videoLink: "https://youtu.be/abc123" },
                },
              },
            ],
          },
        },
      },
    };

    const video = extractVideoFromNextData(data, "module-1");
    expect(video).toEqual({
      url: "https://youtu.be/abc123",
      type: "youtube",
    });
  });

  it("extracts Wistia video", () => {
    const data: SkoolNextData = {
      props: {
        pageProps: {
          course: {
            children: [
              {
                course: {
                  id: "module-1",
                  metadata: { videoLink: "https://fast.wistia.com/embed/abc123" },
                },
              },
            ],
          },
        },
      },
    };

    const video = extractVideoFromNextData(data, "module-1");
    expect(video).toEqual({
      url: "https://fast.wistia.com/embed/abc123",
      type: "wistia",
    });
  });

  it("marks unknown video type for other URLs", () => {
    const data: SkoolNextData = {
      props: {
        pageProps: {
          course: {
            children: [
              {
                course: {
                  id: "module-1",
                  metadata: { videoLink: "https://example.com/video.mp4" },
                },
              },
            ],
          },
        },
      },
    };

    const video = extractVideoFromNextData(data, "module-1");
    expect(video).toEqual({
      url: "https://example.com/video.mp4",
      type: "unknown",
    });
  });

  it("returns null when module is not found", () => {
    const data: SkoolNextData = {
      props: {
        pageProps: {
          course: {
            children: [
              {
                course: { id: "module-1", metadata: { videoLink: "https://loom.com/share/abc" } },
              },
            ],
          },
        },
      },
    };

    const video = extractVideoFromNextData(data, "non-existent-module");
    expect(video).toBeNull();
  });

  it("returns null when videoLink is missing", () => {
    const data: SkoolNextData = {
      props: {
        pageProps: {
          course: {
            children: [
              {
                course: { id: "module-1", metadata: {} },
              },
            ],
          },
        },
      },
    };

    const video = extractVideoFromNextData(data, "module-1");
    expect(video).toBeNull();
  });

  it("returns null for empty data", () => {
    expect(extractVideoFromNextData({}, "module-1")).toBeNull();
  });

  it("handles Loom URL without query params", () => {
    const data: SkoolNextData = {
      props: {
        pageProps: {
          course: {
            children: [
              {
                course: {
                  id: "module-1",
                  metadata: { videoLink: "https://loom.com/share/abc123" },
                },
              },
            ],
          },
        },
      },
    };

    const video = extractVideoFromNextData(data, "module-1");
    expect(video?.url).toBe("https://loom.com/embed/abc123");
  });
});
