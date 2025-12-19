import type { Page } from "playwright";

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
  modules: Array<CourseModule & { lessons: Lesson[] }>;
}

/**
 * Extracts the course/community name from page data.
 */
export async function extractCourseName(page: Page): Promise<string> {
  const title = await page.title();
  // Title format: "Classroom · Community Name"
  const match = title.match(/·\s*(.+)$/);
  return (match?.[1]?.trim() ?? title.replace("Classroom", "").trim()) || "Unknown Course";
}

/**
 * Extracts module data from the embedded JSON in the page.
 * Skool embeds course structure as JSON in a script tag.
 */
export async function extractModulesFromJson(page: Page): Promise<CourseModule[]> {
  const modules = await page.evaluate(() => {
    // Try to get module data from __NEXT_DATA__
    const nextDataScript = document.getElementById("__NEXT_DATA__");
    if (nextDataScript?.textContent) {
      try {
        const json = JSON.parse(nextDataScript.textContent);
        const courseChildren = json?.props?.pageProps?.course?.children;

        if (Array.isArray(courseChildren)) {
          const results: CourseModule[] = [];

          for (const child of courseChildren) {
            const course = child?.course;
            if (!course?.name || !/^[a-f0-9]{8}$/.test(course.name)) continue;

            const slug = course.name;
            const title = course.metadata?.title ?? `Module ${results.length + 1}`;
            // Check hasAccess field - if false, the module/lesson is locked
            const hasAccess = child?.hasAccess !== false;

            if (!results.some((m) => m.slug === slug)) {
              results.push({
                name: title,
                slug,
                url: "",
                isLocked: !hasAccess,
              });
            }
          }

          if (results.length > 0) return results;
        }
      } catch {
        // Fall through to regex approach
      }
    }

    // Fallback: Find script tags that contain course data
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
          const decodedTitle = title.replace(/\\u([0-9a-fA-F]{4})/g, (_, code) =>
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

  const lessons = await page.evaluate(() => {
    const results: Lesson[] = [];

    // First try to get hasAccess from __NEXT_DATA__
    const accessMap = new Map<string, boolean>();
    const nextDataScript = document.getElementById("__NEXT_DATA__");
    if (nextDataScript?.textContent) {
      try {
        const json = JSON.parse(nextDataScript.textContent);
        const courseChildren = json?.props?.pageProps?.course?.children;

        if (Array.isArray(courseChildren)) {
          for (const child of courseChildren) {
            const lessonId = child?.course?.id;
            const hasAccess = child?.hasAccess;
            if (lessonId && typeof hasAccess === "boolean") {
              accessMap.set(lessonId, hasAccess);
            }
          }
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Skool uses styled-components with "ChildrenLink" in the class name
    const lessonLinks = document.querySelectorAll('a[class*="ChildrenLink"]');

    lessonLinks.forEach((link, index) => {
      const anchor = link as HTMLAnchorElement;
      const href = anchor.href;
      const name = anchor.textContent?.trim() ?? `Lesson ${index + 1}`;

      // Extract lesson ID from URL (?md=...)
      const urlParams = new URL(href).searchParams;
      const lessonId = urlParams.get("md") ?? "";

      // Check hasAccess from JSON data first
      let isLocked = false;
      if (accessMap.has(lessonId)) {
        isLocked = !accessMap.get(lessonId);
      } else {
        // Fallback: Check for lock icon in DOM
        let parent: Element | null = anchor;
        for (let i = 0; i < 3 && parent; i++) {
          if (parent.querySelector('[class*="lock"], [class*="Lock"], svg[class*="lock"], svg[class*="Lock"]')) {
            isLocked = true;
            break;
          }
          parent = parent.parentElement;
        }
        // Also check if the link itself has a lock indicator
        if (anchor.querySelector('[class*="lock"], [class*="Lock"]')) {
          isLocked = true;
        }
      }

      if (lessonId && !results.some((l) => l.slug === lessonId)) {
        results.push({
          name,
          slug: lessonId,
          url: href,
          index: results.length,
          isLocked,
        });
      }
    });

    return results;
  });

  return lessons;
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
      const slugMatch = href.match(/\/classroom\/([a-f0-9]{8})(?:\?|$)/);
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

/**
 * Checks if a URL points to a specific module (has 8-char hex slug).
 */
function isModuleUrl(url: string): { isModule: boolean; moduleSlug: string | null } {
  const match = url.match(/\/classroom\/([a-f0-9]{8})(?:\?|$)/);
  return {
    isModule: !!match,
    moduleSlug: match?.[1] ?? null,
  };
}

/**
 * Gets the classroom base URL (without module slug).
 */
function getClassroomBaseUrl(url: string): string {
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

  for (let i = 0; i < modules.length; i++) {
    const module = modules[i]!;

    if (module.isLocked) {
      onProgress?.({
        phase: "lessons",
        currentModule: module.name,
        currentModuleIndex: i,
        skippedLocked: true
      });
      continue;
    }

    onProgress?.({
      phase: "lessons",
      currentModule: module.name,
      currentModuleIndex: i
    });

    if (module.url) {
      const lessons = await extractLessons(page, module.url);

      onProgress?.({
        phase: "lessons",
        currentModule: module.name,
        currentModuleIndex: i,
        lessonsFound: lessons.length
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

/**
 * Creates a filesystem-safe name from a string.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[äöüß]/g, (char) => {
      const replacements: Record<string, string> = {
        ä: "ae",
        ö: "oe",
        ü: "ue",
        ß: "ss",
      };
      return replacements[char] ?? char;
    })
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 100);
}

/**
 * Creates a folder name with index prefix.
 */
export function createFolderName(index: number, name: string): string {
  const prefix = String(index + 1).padStart(2, "0");
  const slug = slugify(name);
  return `${prefix}-${slug}`;
}
