import { describe, expect, it } from "vitest";
import {
  assembleJoshComeauCourseStructure,
  extractJoshComeauCourseSlug,
  isJoshComeauCourseUrl,
  isJoshComeauUrl,
  normalizeJoshComeauCourseUrl,
  type RawJoshComeauModule,
} from "./navigator.js";

describe("Josh Comeau navigator", () => {
  it("detects the platform and all three supported courses", () => {
    expect(isJoshComeauUrl("https://courses.joshwcomeau.com/")).toBe(true);
    expect(isJoshComeauCourseUrl("https://courses.joshwcomeau.com/css-for-js")).toBe(true);
    expect(
      isJoshComeauCourseUrl(
        "https://courses.joshwcomeau.com/joy-of-react/00-introduction/01-welcome"
      )
    ).toBe(true);
    expect(isJoshComeauCourseUrl("https://courses.joshwcomeau.com/wham")).toBe(true);
    expect(isJoshComeauCourseUrl("https://courses.joshwcomeau.com/account")).toBe(false);
    expect(isJoshComeauUrl("https://example.com/css-for-js")).toBe(false);
  });

  it("normalizes lesson URLs to the curriculum", () => {
    expect(
      normalizeJoshComeauCourseUrl(
        "https://courses.joshwcomeau.com/css-for-js/00-introduction/01-welcome?x=1"
      )
    ).toBe("https://courses.joshwcomeau.com/css-for-js");
    expect(extractJoshComeauCourseSlug("https://courses.joshwcomeau.com/wham")).toBe("wham");
    expect(() => normalizeJoshComeauCourseUrl("https://courses.joshwcomeau.com/")).toThrow();
  });

  it("assembles modules, deduplicates lessons, and keeps module-local indices", () => {
    const module: RawJoshComeauModule = {
      name: "Introduction",
      lessons: [
        {
          name: "Welcome!",
          url: "/wham/00-introduction/01-welcome",
        },
        {
          name: "Course Structure",
          url: "/wham/00-introduction/02-structure",
        },
      ],
    };

    const result = assembleJoshComeauCourseStructure(
      "https://courses.joshwcomeau.com/wham",
      "Whimsical Animations",
      [module, module]
    );

    expect(result).toMatchObject({
      name: "Whimsical Animations",
      slug: "wham",
      url: "https://courses.joshwcomeau.com/wham",
    });
    expect(result.modules).toHaveLength(1);
    expect(result.modules[0]?.lessons).toHaveLength(2);
    expect(result.modules[0]?.lessons[1]).toMatchObject({
      name: "Course Structure",
      slug: "02-structure",
      number: 2,
      index: 1,
    });
  });
});
