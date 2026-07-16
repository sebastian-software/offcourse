import type { Page, Response } from "playwright";
import { describe, expect, it, vi } from "vitest";
import {
  createHighLevelCourseTitleCapture,
  slugify,
  createFolderName,
  getHighLevelCourseUrl,
  getHighLevelPostUrl,
} from "./navigator.js";

function productResponse(
  url: string,
  value: unknown
): { response: Response; json: ReturnType<typeof vi.fn> } {
  const json = vi.fn().mockResolvedValue(value);
  const response = {
    url: vi.fn().mockReturnValue(url),
    json,
  } as unknown as Response;
  return { response, json };
}

describe("slugify", () => {
  it("converts to lowercase", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("replaces spaces with hyphens", () => {
    expect(slugify("my test string")).toBe("my-test-string");
  });

  it("removes special characters", () => {
    expect(slugify("Hello! How are you?")).toBe("hello-how-are-you");
  });

  it("replaces German umlauts", () => {
    expect(slugify("Größe")).toBe("groesse");
    expect(slugify("Äpfel")).toBe("aepfel");
    expect(slugify("Übung")).toBe("uebung");
    expect(slugify("Straße")).toBe("strasse");
  });

  it("removes leading and trailing hyphens", () => {
    expect(slugify("--hello--")).toBe("hello");
    expect(slugify("  hello  ")).toBe("hello");
  });

  it("collapses multiple hyphens", () => {
    expect(slugify("hello   world")).toBe("hello-world");
    expect(slugify("hello---world")).toBe("hello-world");
  });

  it("truncates to 100 characters", () => {
    const longName = "a".repeat(150);
    expect(slugify(longName).length).toBe(100);
  });

  it("handles empty string", () => {
    expect(slugify("")).toBe("");
  });

  it("handles numbers", () => {
    expect(slugify("Lesson 1: Introduction")).toBe("lesson-1-introduction");
  });

  it("handles mixed content", () => {
    expect(slugify("🚀 Getting Started! (Part 1)")).toBe("getting-started-part-1");
  });
});

describe("createFolderName", () => {
  it("creates folder name with padded index", () => {
    expect(createFolderName(0, "Introduction")).toBe("01-introduction");
    expect(createFolderName(9, "Conclusion")).toBe("10-conclusion");
  });

  it("handles double-digit indices", () => {
    expect(createFolderName(99, "Final")).toBe("100-final");
  });

  it("slugifies the name", () => {
    expect(createFolderName(0, "Hello World!")).toBe("01-hello-world");
  });

  it("handles German umlauts in name", () => {
    // @sindresorhus/slugify converts & to "and" which preserves meaning
    expect(createFolderName(2, "Größe & Übung")).toBe("03-groesse-and-uebung");
  });
});

describe("getHighLevelCourseUrl", () => {
  it("constructs correct course URL", () => {
    const url = getHighLevelCourseUrl("member.example.com", "abc-123");
    expect(url).toBe("https://member.example.com/courses/products/abc-123?source=courses");
  });

  it("handles UUID product IDs", () => {
    const url = getHighLevelCourseUrl("portal.school.com", "e5f64bf3-9d88-4d02-b10e-516f47866094");
    expect(url).toBe(
      "https://portal.school.com/courses/products/e5f64bf3-9d88-4d02-b10e-516f47866094?source=courses"
    );
  });
});

describe("getHighLevelPostUrl", () => {
  it("constructs correct post URL", () => {
    const url = getHighLevelPostUrl("member.example.com", "product-1", "category-2", "post-3");
    expect(url).toBe(
      "https://member.example.com/courses/products/product-1/categories/category-2/posts/post-3?source=courses"
    );
  });

  it("handles UUID IDs", () => {
    const url = getHighLevelPostUrl(
      "member.test.com",
      "e5f64bf3-9d88-4d02-b10e-516f47866094",
      "cat-abc-123",
      "post-xyz-789"
    );
    expect(url).toContain("products/e5f64bf3-9d88-4d02-b10e-516f47866094");
    expect(url).toContain("categories/cat-abc-123");
    expect(url).toContain("posts/post-xyz-789");
  });
});

describe("createHighLevelCourseTitleCapture", () => {
  it("stops listening before awaiting an in-flight product response", async () => {
    let resolveJson: ((value: unknown) => void) | undefined;
    const response = {
      url: () => "https://services.leadconnectorhq.com/products/product-1",
      json: () => new Promise<unknown>((resolve) => (resolveJson = resolve)),
    } as unknown as Response;
    const off = vi.fn();
    const page = { off } as unknown as Page;
    const capture = createHighLevelCourseTitleCapture("product-1");

    capture.responseHandler(response);
    const result = capture.stop(page);

    expect(off).toHaveBeenCalledWith("response", capture.responseHandler);
    resolveJson?.({ product: { title: "Condition-Based Waiting" } });
    await expect(result).resolves.toBe("Condition-Based Waiting");
  });

  it("ignores unrelated and malformed responses", async () => {
    const unrelated = productResponse(
      "https://services.leadconnectorhq.com/products/another-product",
      { product: { title: "Wrong course" } }
    );
    const malformed = productResponse(
      "https://services.leadconnectorhq.com/products/product-1",
      Promise.reject(new Error("invalid JSON"))
    );
    const page = { off: vi.fn() } as unknown as Page;
    const capture = createHighLevelCourseTitleCapture("product-1");

    capture.responseHandler(unrelated.response);
    capture.responseHandler(malformed.response);

    await expect(capture.stop(page)).resolves.toBeNull();
    expect(unrelated.json).not.toHaveBeenCalled();
  });
});
