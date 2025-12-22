import type { Page } from "playwright";
import {
  parseNextData,
  extractModulesFromNextData,
  extractLessonAccessFromNextData,
} from "./schemas.js";

export interface CourseModule {
  name: string;
  slug: string;
  url: string;
  isLocked: boolean;
}

export interface Lesson {
  name: string;
  slug: string;
  url: string;
  index: number;
  isLocked: boolean;
}

export interface CourseStructure {
  name: string;
  url: string;
  modules: (CourseModule & { lessons: Lesson[] })[];
}

// Browser automation - requires Playwright
/* v8 ignore start */

/**
 * Extracts the course/community name from page data.
 */
export async function extractCourseName(page: Page): Promise<string> {
  const title = await page.title();
  // Title format: "Classroom · Community Name"
  const match = /·\s*(.+)$/.exec(title);
  return (match?.[1]?.trim() ?? title.replace("Classroom", "").trim()) || "Unknown Course";
}

/**
 * Extracts module data from the embedded JSON in the page.
 * Skool embeds course structure as JSON in a script tag.
 */
export async function extractModulesFromJson(page: Page): Promise<CourseModule[]> {
  // Get the raw JSON from the page
  const nextDataJson = await page.evaluate(() => {
    const nextDataScript = document.getElementById("__NEXT_DATA__");
    return nextDataScript?.textContent ?? null;
  });

  // Parse and validate with Zod schema (in Node context)
  if (nextDataJson) {
    const parsed = parseNextData(nextDataJson);
    if (parsed) {
      const skoolModules = extractModulesFromNextData(parsed);
      if (skoolModules.length > 0) {
        const baseUrl = page.url().split("/classroom")[0];
        return skoolModules.map((m) => ({
          name: m.title,
          slug: m.slug,
          url: `${baseUrl}/classroom/${m.slug}`,
          isLocked: !m.hasAccess,
        }));
      }
    }
  }

  // Fallback: Find script tags that contain course data (regex approach)
  const modules = await page.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll("script"));
    const results: CourseModule[] = [];

    for (const script of scripts) {
      const content = script.textContent ?? "";

      // Look for module data pattern in the JSON
      // Structure: "id":"...","name":"SLUG","metadata":{..."title":"TITLE"...}
      // Pattern: "name":"8-char-hex" followed by "title":"..." within metadata
      const modulePattern = /"name":"([a-f0-9]{8})","metadata":\{[^}]*"title":"([^"]+)"/g;
      let match;

      while ((match = modulePattern.exec(content)) !== null) {
        const slug = match[1];
        const title = match[2];

        // Skip if already added
        if (slug && title && !results.some((m) => m.slug === slug)) {
          // Decode unicode escapes (e.g., \u0026 -> &)
          const decodedTitle = title.replace(/\\u([0-9a-fA-F]{4})/g, (_, code: string) =>
            String.fromCharCode(parseInt(code, 16))
          );

          results.push({
            name: decodedTitle,
            slug,
            url: "", // Will be set later
            isLocked: false,
          });
        }
      }
    }

    return results;
  });

  // Build URLs for each module
  const baseUrl = page.url().split("/classroom")[0];

  return modules.map((module) => ({
    ...module,
    url: `${baseUrl}/classroom/${module.slug}`,
  }));
}

/**
 * Extracts lessons from a module page.
 * Lessons are listed in the sidebar with links.
 */
export async function extractLessons(page: Page, moduleUrl: string): Promise<Lesson[]> {
  const currentUrl = page.url();

  const moduleBasePath = moduleUrl.split("?")[0] ?? moduleUrl;
  if (!currentUrl.includes(moduleBasePath)) {
    await page.goto(moduleUrl, { timeout: 30000 });
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);
  }

  // Get __NEXT_DATA__ and parse it in Node context
  const nextDataJson = await page.evaluate(() => {
    const nextDataScript = document.getElementById("__NEXT_DATA__");
    return nextDataScript?.textContent ?? null;
  });

  // Build access map from validated data
  let accessMap = new Map<string, boolean>();
  if (nextDataJson) {
    const parsed = parseNextData(nextDataJson);
    if (parsed) {
      accessMap = extractLessonAccessFromNextData(parsed);
    }
  }

  // Extract lesson links from DOM
  const lessonData = await page.evaluate(() => {
    const results: { name: string; slug: string; href: string }[] = [];

    // Skool uses styled-components with "ChildrenLink" in the class name
    const lessonLinks = document.querySelectorAll('a[class*="ChildrenLink"]');

    lessonLinks.forEach((link, index) => {
      const anchor = link as HTMLAnchorElement;
      const href = anchor.href;
      const name = anchor.textContent?.trim() ?? `Lesson ${index + 1}`;

      // Extract lesson ID from URL (?md=...)
      const urlParams = new URL(href).searchParams;
      const lessonId = urlParams.get("md") ?? "";

      if (lessonId && !results.some((l) => l.slug === lessonId)) {
        results.push({ name, slug: lessonId, href });
      }
    });

    return results;
  });

  // Build final lesson list with access info
  return lessonData.map((lesson, index) => {
    let isLocked = false;

    // Check access map from __NEXT_DATA__
    if (accessMap.has(lesson.slug)) {
      isLocked = !accessMap.get(lesson.slug);
    }

    return {
      name: lesson.name,
      slug: lesson.slug,
      url: lesson.href,
      index,
      isLocked,
    };
  });
}

/**
 * Alternative: Extract modules from the classroom overview page links.
 */
export async function extractModulesFromPage(page: Page): Promise<CourseModule[]> {
  await page.waitForTimeout(1000);

  const modules = await page.evaluate(() => {
    // Look for module cards - they're usually divs/links with course images
    const moduleCards = document.querySelectorAll('a[href*="/classroom/"]');
    const results: CourseModule[] = [];
    const seen = new Set<string>();

    moduleCards.forEach((card) => {
      const anchor = card as HTMLAnchorElement;
      const href = anchor.href;

      // Extract slug from URL (8 character hex string)
      const slugMatch = /\/classroom\/([a-f0-9]{8})(?:\?|$)/.exec(href);
      if (!slugMatch?.[1]) return;

      const slug = slugMatch[1];
      if (seen.has(slug)) return;
      seen.add(slug);

      // Find title - could be in various child elements
      const titleEl =
        card.querySelector("h3, h4, [class*='title'], [class*='Title']") ??
        card.querySelector("div > div > div");
      const name = titleEl?.textContent?.trim() ?? `Module ${results.length + 1}`;

      // Check for lock icon
      const isLocked = card.querySelector('[class*="lock"], [class*="Lock"]') !== null;

      results.push({
        name,
        slug,
        url: href,
        isLocked,
      });
    });

    return results;
  });

  return modules;
}
/* v8 ignore stop */

/**
 * Checks if a URL points to a specific module (has 8-char hex slug).
 */
export function isModuleUrl(url: string): { isModule: boolean; moduleSlug: string | null } {
  const match = /\/classroom\/([a-f0-9]{8})(?:\?|$)/.exec(url);
  return {
    isModule: !!match,
    moduleSlug: match?.[1] ?? null,
  };
}

/**
 * Gets the classroom base URL (without module slug).
 */
export function getClassroomBaseUrl(url: string): string {
  // Remove module slug and query params
  return url.replace(/\/classroom\/[a-f0-9]{8}.*$/, "/classroom");
}

/**
 * Progress callback for buildCourseStructure.
 */
export interface ScanProgress {
  phase: "init" | "modules" | "lessons" | "done";
  courseName?: string;
  totalModules?: number;
  currentModule?: string;
  currentModuleIndex?: number;
  lessonsFound?: number;
  skippedLocked?: boolean;
}

/* v8 ignore start */
/**
 * Builds the complete course structure by crawling all modules and lessons.
 */
export async function buildCourseStructure(
  page: Page,
  classroomUrl: string,
  onProgress?: (progress: ScanProgress) => void
): Promise<CourseStructure> {
  const { isModule, moduleSlug } = isModuleUrl(classroomUrl);

  // If URL points to a specific module, get the base classroom URL first
  const baseClassroomUrl = isModule ? getClassroomBaseUrl(classroomUrl) : classroomUrl;

  // Navigate to the classroom overview to get all modules
  await page.goto(baseClassroomUrl, { timeout: 30000 });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2000);

  const courseName = await extractCourseName(page);
  onProgress?.({ phase: "init", courseName });

  // Try JSON extraction first (more reliable), fall back to page scraping
  let modules = await extractModulesFromJson(page);

  if (modules.length === 0) {
    modules = await extractModulesFromPage(page);
  }

  // If user specified a specific module, filter to just that one
  if (isModule && moduleSlug) {
    const targetModule = modules.find((m) => m.slug === moduleSlug);
    if (targetModule) {
      modules = [targetModule];
    }
  }

  onProgress?.({ phase: "modules", totalModules: modules.length });

  const modulesWithLessons: CourseStructure["modules"] = [];

  for (const [i, module] of modules.entries()) {
    if (module.isLocked) {
      onProgress?.({
        phase: "lessons",
        currentModule: module.name,
        currentModuleIndex: i,
        skippedLocked: true,
      });
      continue;
    }

    onProgress?.({
      phase: "lessons",
      currentModule: module.name,
      currentModuleIndex: i,
    });

    if (module.url) {
      const lessons = await extractLessons(page, module.url);

      onProgress?.({
        phase: "lessons",
        currentModule: module.name,
        currentModuleIndex: i,
        lessonsFound: lessons.length,
      });

      modulesWithLessons.push({
        ...module,
        lessons,
      });
    }
  }

  onProgress?.({ phase: "done" });

  return {
    name: courseName,
    url: baseClassroomUrl,
    modules: modulesWithLessons,
  };
}
/* v8 ignore stop */

// Re-export shared utilities for backwards compatibility
export { slugify, createFolderName } from "../shared/slug.js";
