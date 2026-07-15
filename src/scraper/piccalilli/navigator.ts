import type { Page } from "playwright";
import { slugify } from "../../shared/slug.js";

export interface PiccalilliLesson {
  name: string;
  slug: string;
  url: string;
  number: number;
  index: number;
  isFree: boolean;
  duration: string | null;
}

export interface PiccalilliModule {
  name: string;
  slug: string;
  number: number;
  index: number;
  lessons: PiccalilliLesson[];
}

export interface PiccalilliCourseStructure {
  name: string;
  slug: string;
  url: string;
  modules: PiccalilliModule[];
}

export interface RawPiccalilliModule {
  name: string;
  number: number;
  lessons: {
    name: string;
    url: string;
    number: number;
    isFree: boolean;
    duration: string | null;
  }[];
}

/** Returns whether a URL points to a Piccalilli course overview or lesson. */
export function isPiccalilliCourseUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const isPiccalilli = parsed.hostname === "piccalil.li" || parsed.hostname === "www.piccalil.li";
    return isPiccalilli && /^\/[^/]+\/lessons(?:\/\d+)?\/?$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

/** Normalizes a lesson URL to its course overview URL. */
export function normalizePiccalilliCourseUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.hostname !== "piccalil.li" && parsed.hostname !== "www.piccalil.li") {
    throw new Error("Not a Piccalilli URL");
  }

  const match = /^(\/[^/]+\/lessons)(?:\/\d+)?\/?$/.exec(parsed.pathname);
  if (!match?.[1]) {
    throw new Error("Expected a Piccalilli course or lesson URL");
  }

  return `https://piccalil.li${match[1]}`;
}

/** Extracts the course slug immediately before the `/lessons` path segment. */
export function extractPiccalilliCourseSlug(url: string): string {
  const overviewUrl = normalizePiccalilliCourseUrl(url);
  const match = /piccalil\.li\/([^/]+)\/lessons$/.exec(overviewUrl);
  if (!match?.[1]) {
    throw new Error("Could not determine Piccalilli course slug");
  }
  return match[1];
}

/**
 * Builds a clean structure from DOM data and removes Piccalilli's duplicated
 * desktop/mobile course navigation.
 */
export function assemblePiccalilliCourseStructure(
  courseUrl: string,
  courseName: string,
  rawModules: RawPiccalilliModule[]
): PiccalilliCourseStructure {
  const seenLessons = new Set<string>();
  const modules: PiccalilliModule[] = [];

  for (const rawModule of rawModules) {
    const lessons: PiccalilliLesson[] = [];

    for (const rawLesson of rawModule.lessons) {
      const normalizedUrl = new URL(rawLesson.url, courseUrl).href;
      if (seenLessons.has(normalizedUrl)) continue;
      seenLessons.add(normalizedUrl);

      lessons.push({
        name: rawLesson.name,
        slug: String(rawLesson.number),
        url: normalizedUrl,
        number: rawLesson.number,
        index: lessons.length,
        isFree: rawLesson.isFree,
        duration: rawLesson.duration,
      });
    }

    if (lessons.length === 0) continue;

    const name = rawModule.name || `Module ${rawModule.number}`;
    modules.push({
      name,
      slug: slugify(name),
      number: rawModule.number || modules.length + 1,
      index: modules.length,
      lessons,
    });
  }

  return {
    name: courseName,
    slug: extractPiccalilliCourseSlug(courseUrl),
    url: normalizePiccalilliCourseUrl(courseUrl),
    modules,
  };
}

/** Reads the complete course hierarchy from the public Piccalilli overview. */
export async function buildPiccalilliCourseStructure(
  page: Page,
  url: string
): Promise<PiccalilliCourseStructure> {
  const courseUrl = normalizePiccalilliCourseUrl(url);
  if (page.url() !== courseUrl) {
    await page.goto(courseUrl, { timeout: 30000 });
    await page.waitForLoadState("domcontentloaded");
  }

  await page.waitForSelector(".course-navigation__child", {
    state: "attached",
    timeout: 10000,
  });

  const pageData = await page.evaluate(() => {
    const courseName =
      document.querySelector(".course-header__name")?.textContent?.trim() ??
      document.title.split(" - Course overview")[0]?.trim() ??
      "Piccalilli Course";

    const modules = Array.from(document.querySelectorAll(".course-navigation__child")).map(
      (moduleElement, moduleIndex) => {
        const heading = moduleElement.querySelector(".course-navigation__child-heading");
        const headingParts = Array.from(heading?.children ?? [])
          .map((element) => element.textContent?.trim() ?? "")
          .filter(Boolean);
        const moduleLabel = headingParts[0] ?? "";
        const moduleNumber = Number(/\d+/.exec(moduleLabel)?.[0] ?? moduleIndex + 1);
        const moduleName =
          headingParts[1] ??
          heading?.textContent?.replace(/^(?:Module|Unit)\s+\d+\s*/i, "").trim() ??
          `Module ${moduleNumber}`;

        const lessons = Array.from(
          moduleElement.querySelectorAll<HTMLAnchorElement>("a.course-navigation__lesson[href]")
        ).map((lessonElement, lessonIndex) => {
          const href = lessonElement.href;
          const pathNumber = Number(/\/lessons\/(\d+)\/?$/.exec(new URL(href).pathname)?.[1]);
          const displayedNumber = Number(
            lessonElement
              .querySelector(".course-navigation__lesson-number")
              ?.textContent?.replace(/\D/g, "")
          );
          const number =
            pathNumber > 0 ? pathNumber : displayedNumber > 0 ? displayedNumber : lessonIndex + 1;
          const duration = Array.from(lessonElement.querySelectorAll(".course-navigation__meta"))
            .map((element) => element.textContent?.trim() ?? "")
            .find((text) => /(?:\d+:\d+|\d+\s+hr)/.test(text));

          return {
            name:
              lessonElement
                .querySelector(".course-navigation__lesson-title")
                ?.textContent?.trim() ?? `Lesson ${number}`,
            url: href,
            number,
            isFree: lessonElement.querySelector('[data-access="true"]') !== null,
            duration: duration ?? null,
          };
        });

        return { name: moduleName, number: moduleNumber, lessons };
      }
    );

    return { courseName, modules };
  });

  return assemblePiccalilliCourseStructure(courseUrl, pageData.courseName, pageData.modules);
}
