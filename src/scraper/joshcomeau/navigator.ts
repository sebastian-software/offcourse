import type { Page } from "playwright";
import { slugify } from "../../shared/slug.js";

export const JOSH_COMEAU_COURSE_SLUGS = ["css-for-js", "joy-of-react", "wham"] as const;

export type JoshComeauCourseSlug = (typeof JOSH_COMEAU_COURSE_SLUGS)[number];

export interface JoshComeauLesson {
  name: string;
  slug: string;
  url: string;
  number: number;
  index: number;
}

export interface JoshComeauModule {
  name: string;
  slug: string;
  number: number;
  index: number;
  lessons: JoshComeauLesson[];
}

export interface JoshComeauCourseStructure {
  name: string;
  slug: JoshComeauCourseSlug;
  url: string;
  modules: JoshComeauModule[];
}

export interface RawJoshComeauModule {
  name: string;
  lessons: { name: string; url: string }[];
}

function isKnownCourseSlug(value: string | undefined): value is JoshComeauCourseSlug {
  return JOSH_COMEAU_COURSE_SLUGS.some((slug) => slug === value);
}

/** Returns whether a URL belongs to Josh Comeau's course platform. */
export function isJoshComeauUrl(url: string): boolean {
  try {
    return new URL(url).hostname === "courses.joshwcomeau.com";
  } catch {
    return false;
  }
}

/** Returns whether a URL identifies one of the supported Josh Comeau courses or lessons. */
export function isJoshComeauCourseUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const courseSlug = parsed.pathname.split("/").find(Boolean);
    return parsed.hostname === "courses.joshwcomeau.com" && isKnownCourseSlug(courseSlug);
  } catch {
    return false;
  }
}

/** Normalizes a course or lesson URL to its course curriculum URL. */
export function normalizeJoshComeauCourseUrl(url: string): string {
  const parsed = new URL(url);
  const courseSlug = parsed.pathname.split("/").find(Boolean);
  if (parsed.hostname !== "courses.joshwcomeau.com" || !isKnownCourseSlug(courseSlug)) {
    throw new Error("Expected a Josh Comeau course or lesson URL");
  }
  return `https://courses.joshwcomeau.com/${courseSlug}`;
}

export function extractJoshComeauCourseSlug(url: string): JoshComeauCourseSlug {
  const courseSlug = new URL(normalizeJoshComeauCourseUrl(url)).pathname.slice(1);
  if (!isKnownCourseSlug(courseSlug)) {
    throw new Error("Could not determine Josh Comeau course slug");
  }
  return courseSlug;
}

export function assembleJoshComeauCourseStructure(
  courseUrl: string,
  courseName: string,
  rawModules: RawJoshComeauModule[]
): JoshComeauCourseStructure {
  const normalizedCourseUrl = normalizeJoshComeauCourseUrl(courseUrl);
  const seenLessons = new Set<string>();
  const modules: JoshComeauModule[] = [];

  for (const rawModule of rawModules) {
    const lessons: JoshComeauLesson[] = [];
    for (const rawLesson of rawModule.lessons) {
      const normalizedUrl = new URL(rawLesson.url, normalizedCourseUrl).href;
      if (seenLessons.has(normalizedUrl)) continue;
      seenLessons.add(normalizedUrl);

      const lessonSlug = new URL(normalizedUrl).pathname.split("/").filter(Boolean).at(-1);
      lessons.push({
        name: rawLesson.name || `Lesson ${lessons.length + 1}`,
        slug: lessonSlug ?? String(lessons.length + 1),
        url: normalizedUrl,
        number: lessons.length + 1,
        index: lessons.length,
      });
    }

    if (lessons.length === 0) continue;
    const name = rawModule.name || `Module ${modules.length + 1}`;
    modules.push({
      name,
      slug: slugify(name),
      number: modules.length + 1,
      index: modules.length,
      lessons,
    });
  }

  return {
    name: courseName,
    slug: extractJoshComeauCourseSlug(normalizedCourseUrl),
    url: normalizedCourseUrl,
    modules,
  };
}

/** Reads the complete accessible curriculum from a Josh Comeau course page. */
export async function buildJoshComeauCourseStructure(
  page: Page,
  url: string
): Promise<JoshComeauCourseStructure> {
  const courseUrl = normalizeJoshComeauCourseUrl(url);
  if (page.url() !== courseUrl) {
    await page.goto(courseUrl, { timeout: 30000 });
    await page.waitForLoadState("domcontentloaded");
  }

  await page.waitForSelector('a[data-test="module-lesson-anchor"]', {
    state: "attached",
    timeout: 15000,
  });

  const pageData = await page.evaluate(() => {
    const courseName =
      document.querySelector("main h1")?.textContent?.trim() ?? "Josh Comeau Course";
    const modules = Array.from(document.querySelectorAll("main article")).map((article, index) => {
      const name = article.querySelector("h2")?.textContent?.trim() ?? `Module ${index + 1}`;
      const lessons = Array.from(
        article.querySelectorAll<HTMLAnchorElement>('a[data-test="module-lesson-anchor"][href]')
      ).map((link, lessonIndex) => {
        const directText = Array.from(link.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent?.trim() ?? "")
          .filter(Boolean)
          .join(" ");
        return {
          name: directText || `Lesson ${lessonIndex + 1}`,
          url: link.href,
        };
      });
      return { name, lessons };
    });
    return { courseName, modules };
  });

  return assembleJoshComeauCourseStructure(courseUrl, pageData.courseName, pageData.modules);
}
