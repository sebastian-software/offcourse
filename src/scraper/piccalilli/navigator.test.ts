import { describe, expect, it } from "vitest";
import {
  assemblePiccalilliCourseStructure,
  extractPiccalilliCourseSlug,
  isPiccalilliCourseUrl,
  normalizePiccalilliCourseUrl,
  type RawPiccalilliModule,
} from "./navigator.js";

describe("Piccalilli navigator", () => {
  it("detects course overview and lesson URLs", () => {
    expect(isPiccalilliCourseUrl("https://piccalil.li/mindful-design/lessons")).toBe(true);
    expect(isPiccalilliCourseUrl("https://piccalil.li/mindful-design/lessons/59")).toBe(true);
    expect(isPiccalilliCourseUrl("https://piccalil.li/mindful-design")).toBe(false);
    expect(isPiccalilliCourseUrl("https://example.com/mindful-design/lessons")).toBe(false);
    expect(isPiccalilliCourseUrl("not-a-url")).toBe(false);
  });

  it("normalizes lesson URLs and extracts the course slug", () => {
    expect(
      normalizePiccalilliCourseUrl("https://www.piccalil.li/mindful-design/lessons/59?x=1")
    ).toBe("https://piccalil.li/mindful-design/lessons");
    expect(extractPiccalilliCourseSlug("https://piccalil.li/mindful-design/lessons/1")).toBe(
      "mindful-design"
    );
  });

  it("rejects unrelated Piccalilli paths", () => {
    expect(() => normalizePiccalilliCourseUrl("https://piccalil.li/courses")).toThrow();
    expect(() => normalizePiccalilliCourseUrl("https://example.com/course/lessons")).toThrow();
  });

  it("deduplicates mirrored navigation and keeps module-local lesson indices", () => {
    const module: RawPiccalilliModule = {
      name: "Intro & Welcome",
      number: 1,
      lessons: [
        {
          name: "Welcome",
          url: "/mindful-design/lessons/1",
          number: 1,
          isFree: true,
          duration: "4:34 mins",
        },
        {
          name: "Tools",
          url: "/mindful-design/lessons/2",
          number: 2,
          isFree: false,
          duration: "5:03 mins",
        },
      ],
    };

    const result = assemblePiccalilliCourseStructure(
      "https://piccalil.li/mindful-design/lessons",
      "Mindful Design",
      [module, module]
    );

    expect(result.modules).toHaveLength(1);
    expect(result.modules[0]?.lessons).toHaveLength(2);
    expect(result.modules[0]?.lessons.map((lesson) => lesson.index)).toEqual([0, 1]);
    expect(result.modules[0]?.lessons[1]).toMatchObject({
      name: "Tools",
      number: 2,
      isFree: false,
    });
  });
});
