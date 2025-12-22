import type { Page } from "playwright";
import {
  safeParse,
  CourseSchema,
  ModuleSchema,
  LessonSchema,
  type Course,
  type Module,
  type Lesson,
} from "./schemas.js";

export interface LearningSuiteCourse {
  id: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  moduleCount: number;
  lessonCount: number;
}

export interface LearningSuiteModule {
  id: string;
  title: string;
  description: string | null;
  position: number;
  isLocked: boolean;
}

export interface LearningSuiteLesson {
  id: string;
  title: string;
  position: number;
  moduleId: string;
  isLocked: boolean;
  isCompleted: boolean;
}

export interface LearningSuiteCourseStructure {
  course: LearningSuiteCourse;
  modules: (LearningSuiteModule & { lessons: LearningSuiteLesson[] })[];
  tenantId: string;
  domain: string;
  courseSlug?: string;
}

export interface LearningSuiteScanProgress {
  phase: "init" | "course" | "modules" | "lessons" | "done";
  courseName?: string;
  totalModules?: number;
  currentModule?: string;
  currentModuleIndex?: number;
  lessonsFound?: number;
  skippedLocked?: boolean;
}

// ============================================================================
// Tenant Extraction
// ============================================================================

/**
 * Extracts the tenant ID from a LearningSuite URL.
 * URL format: https://{subdomain}.learningsuite.io/...
 */
export function extractTenantFromUrl(url: string): { subdomain: string; tenantId: string | null } {
  const urlObj = new URL(url);
  const hostname = urlObj.hostname;

  // Extract subdomain from learningsuite.io
  const match = /^([^.]+)\.learningsuite\.io$/.exec(hostname);
  if (!match?.[1]) {
    return { subdomain: "", tenantId: null };
  }

  return {
    subdomain: match[1],
    tenantId: null, // Will be resolved by API
  };
}

// ============================================================================
// Browser/API Automation
// ============================================================================
/* v8 ignore start */

/**
 * Extracts the tenant ID from the page by inspecting network requests or localStorage.
 */
export async function extractTenantId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    // Try to find tenant ID in localStorage
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        const value = localStorage.getItem(key);
        if (value) {
          // Look for tenant ID patterns
          const match = /"tenantId":\s*"([^"]+)"/.exec(value);
          if (match?.[1]) return match[1];
        }
      }
    }

    // Check meta tags or data attributes
    const metaTenant = document.querySelector('meta[name="tenant-id"]');
    if (metaTenant) {
      return metaTenant.getAttribute("content");
    }

    // Check for tenant in script tags (common in SPAs)
    const scripts = Array.from(document.querySelectorAll("script"));
    for (const script of scripts) {
      const content = script.textContent ?? "";
      const tenantMatch = /tenantId['":\s]+['"]([a-z0-9]+)['"]/i.exec(content);
      if (tenantMatch?.[1]) {
        return tenantMatch[1];
      }
    }

    return null;
  });
}

/**
 * Extracts tenant ID from page by looking at script content and link hrefs.
 */
async function extractTenantIdFromPage(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    // Check for any API calls that contain the tenant ID
    const apiPattern = /api\.learningsuite\.io\/([a-z0-9]+)\/graphql/;
    const scripts = Array.from(document.querySelectorAll("script"));
    for (const script of scripts) {
      const src = script.src ?? "";
      const content = script.textContent ?? "";
      const match = apiPattern.exec(src) ?? apiPattern.exec(content);
      if (match?.[1]) return match[1];
    }

    // Check network resource hints
    const links = Array.from(document.querySelectorAll('link[href*="learningsuite"]'));
    for (const link of links) {
      const href = (link as HTMLLinkElement).href ?? "";
      const match = /\/([a-z0-9]{20,})\//.exec(href);
      if (match?.[1]) return match[1];
    }

    return null;
  });
}

/**
 * Gets the auth token from localStorage.
 */
export async function getAuthToken(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    // Look for common token storage patterns
    const tokenKeys = ["accessToken", "token", "authToken", "jwt", "access_token"];

    for (const key of tokenKeys) {
      const value = localStorage.getItem(key);
      if (value) return value;
    }

    // Try sessionStorage
    for (const key of tokenKeys) {
      const value = sessionStorage.getItem(key);
      if (value) return value;
    }

    // Look in any localStorage key that might contain a token
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.toLowerCase().includes("auth") || key?.toLowerCase().includes("token")) {
        const value = localStorage.getItem(key);
        if (value) {
          try {
            const parsed = JSON.parse(value) as Record<string, unknown>;
            if (typeof parsed.accessToken === "string") return parsed.accessToken;
            if (typeof parsed.token === "string") return parsed.token;
          } catch {
            // If it's not JSON, it might be the token itself
            if (value.length > 20 && !value.includes(" ")) {
              return value;
            }
          }
        }
      }
    }

    return null;
  });
}

/**
 * Makes a GraphQL request to the LearningSuite API.
 */
export async function graphqlRequest<T>(
  page: Page,
  tenantId: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T | null> {
  const authToken = await getAuthToken(page);

  const result = await page.evaluate(
    async ({ tenantId, query, variables, authToken }) => {
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };

        if (authToken) {
          headers.Authorization = `Bearer ${authToken}`;
        }

        const response = await fetch(`https://api.learningsuite.io/${tenantId}/graphql`, {
          method: "POST",
          headers,
          body: JSON.stringify({ query, variables }),
        });

        if (!response.ok) {
          return { error: `HTTP ${response.status}`, status: response.status };
        }

        const data: unknown = await response.json();
        return { data };
      } catch (error) {
        return { error: String(error) };
      }
    },
    { tenantId, query, variables, authToken }
  );

  if ("error" in result) {
    console.error(`[GraphQL] Request failed: ${result.error}`);
    return null;
  }

  return result.data as T;
}

/**
 * Fetches all courses available to the user.
 */
export async function fetchCourses(page: Page, tenantId: string): Promise<Course[]> {
  const query = `
    query GetMyCourses {
      myCourses {
        id
        title
        description
        thumbnailUrl
        progress
        moduleCount
        lessonCount
      }
    }
  `;

  const response = await graphqlRequest<{ data: { myCourses: unknown[] } }>(page, tenantId, query);

  if (!response?.data?.myCourses) {
    // Try alternative query
    const altQuery = `
      query GetProducts {
        products {
          id
          title
          description
          imageUrl
        }
      }
    `;

    const altResponse = await graphqlRequest<{ data: { products: unknown[] } }>(
      page,
      tenantId,
      altQuery
    );

    if (altResponse?.data?.products) {
      return altResponse.data.products
        .map((p) => safeParse(CourseSchema, p, "fetchCourses.alt"))
        .filter((c): c is Course => c !== null);
    }

    return [];
  }

  return response.data.myCourses
    .map((c) => safeParse(CourseSchema, c, "fetchCourses"))
    .filter((c): c is Course => c !== null);
}

/**
 * Fetches modules for a course.
 */
export async function fetchModules(
  page: Page,
  tenantId: string,
  courseId: string
): Promise<Module[]> {
  const query = `
    query GetCourseModules($courseId: ID!) {
      course(id: $courseId) {
        modules {
          id
          title
          description
          position
          isLocked
          lessonCount
        }
      }
    }
  `;

  const response = await graphqlRequest<{ data: { course: { modules: unknown[] } } }>(
    page,
    tenantId,
    query,
    { courseId }
  );

  if (!response?.data?.course?.modules) {
    // Try alternative query (chapters)
    const altQuery = `
      query GetCourseChapters($courseId: ID!) {
        course(id: $courseId) {
          chapters {
            id
            title
            description
            order
            isLocked
          }
        }
      }
    `;

    const altResponse = await graphqlRequest<{ data: { course: { chapters: unknown[] } } }>(
      page,
      tenantId,
      altQuery,
      { courseId }
    );

    if (altResponse?.data?.course?.chapters) {
      return altResponse.data.course.chapters
        .map((m) => safeParse(ModuleSchema, m, "fetchModules.alt"))
        .filter((m): m is Module => m !== null);
    }

    return [];
  }

  return response.data.course.modules
    .map((m) => safeParse(ModuleSchema, m, "fetchModules"))
    .filter((m): m is Module => m !== null);
}

/**
 * Fetches lessons for a module.
 */
export async function fetchLessons(
  page: Page,
  tenantId: string,
  courseId: string,
  moduleId: string
): Promise<Lesson[]> {
  const query = `
    query GetModuleLessons($courseId: ID!, $moduleId: ID!) {
      course(id: $courseId) {
        module(id: $moduleId) {
          lessons {
            id
            title
            description
            position
            isLocked
            isCompleted
            duration
            contentType
          }
        }
      }
    }
  `;

  const response = await graphqlRequest<{ data: { course: { module: { lessons: unknown[] } } } }>(
    page,
    tenantId,
    query,
    { courseId, moduleId }
  );

  if (!response?.data?.course?.module?.lessons) {
    // Try alternative query
    const altQuery = `
      query GetChapterLessons($chapterId: ID!) {
        chapter(id: $chapterId) {
          lessons {
            id
            title
            description
            order
            isLocked
            isCompleted
          }
        }
      }
    `;

    const altResponse = await graphqlRequest<{ data: { chapter: { lessons: unknown[] } } }>(
      page,
      tenantId,
      altQuery,
      { chapterId: moduleId }
    );

    if (altResponse?.data?.chapter?.lessons) {
      return altResponse.data.chapter.lessons
        .map((l) => safeParse(LessonSchema, l, "fetchLessons.alt"))
        .filter((l): l is Lesson => l !== null);
    }

    return [];
  }

  return response.data.course.module.lessons
    .map((l) => safeParse(LessonSchema, l, "fetchLessons"))
    .filter((l): l is Lesson => l !== null);
}

/**
 * Extracts courses from the page DOM (fallback method).
 */
export async function extractCoursesFromPage(page: Page): Promise<LearningSuiteCourse[]> {
  return page.evaluate(() => {
    const courses: LearningSuiteCourse[] = [];

    // Look for course cards/links
    const courseElements = document.querySelectorAll(
      '[class*="course"], [class*="Course"], [data-course-id], a[href*="/course/"]'
    );

    const seen = new Set<string>();

    for (const el of Array.from(courseElements)) {
      // Try to extract course ID from data attribute or href
      let id = (el as HTMLElement).dataset.courseId ?? "";
      const href = (el as HTMLAnchorElement).href ?? "";

      if (!id && href) {
        const match = /\/course[s]?\/([^/]+)/.exec(href);
        if (match?.[1]) id = match[1];
      }

      if (!id || seen.has(id)) continue;
      seen.add(id);

      // Extract title
      const titleEl = el.querySelector("h2, h3, h4, [class*='title'], [class*='Title']");
      const title = titleEl?.textContent?.trim() ?? `Course ${courses.length + 1}`;

      // Extract description
      const descEl = el.querySelector("p, [class*='description'], [class*='Description']");
      const description = descEl?.textContent?.trim() ?? null;

      // Extract thumbnail
      const imgEl = el.querySelector("img");
      const thumbnailUrl = imgEl?.src ?? null;

      courses.push({
        id,
        title,
        description,
        thumbnailUrl,
        moduleCount: 0,
        lessonCount: 0,
      });
    }

    return courses;
  });
}

/**
 * Builds the complete course structure for a LearningSuite course using DOM extraction.
 * This is more reliable than GraphQL as the API structure may vary between instances.
 */
export async function buildLearningSuiteCourseStructure(
  page: Page,
  courseUrl: string,
  onProgress?: (progress: LearningSuiteScanProgress) => void
): Promise<LearningSuiteCourseStructure | null> {
  // Extract domain and tenant info
  const urlObj = new URL(courseUrl);
  const domain = urlObj.hostname;

  onProgress?.({ phase: "init" });

  // Navigate to course page
  await page.goto(courseUrl, { timeout: 30000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(3000);

  // Extract tenant ID from page
  const tenantId = (await extractTenantId(page)) ?? (await extractTenantIdFromPage(page));

  if (!tenantId) {
    console.error("Could not determine tenant ID for LearningSuite portal");
    return null;
  }

  // Extract course ID from URL
  // URL formats:
  //   - /student/course/{slug}/{id} (e.g., /student/course/einfuehrung-in-die-akademie/mgLFsjbW)
  //   - /course/{id}
  let courseId: string | null = null;

  // Try format: /student/course/{slug}/{id}
  const twoPartMatch = /\/course\/[^/]+\/([^/?]+)/.exec(courseUrl);
  if (twoPartMatch?.[1]) {
    courseId = twoPartMatch[1];
  } else {
    // Try format: /course/{id}
    const onePartMatch = /\/course\/([^/?]+)/.exec(courseUrl);
    if (onePartMatch?.[1]) {
      courseId = onePartMatch[1];
    }
  }

  if (!courseId) {
    // Try to find course ID from current page URL
    const pageUrl = page.url();
    const pageTwoPartMatch = /\/course\/[^/]+\/([^/?]+)/.exec(pageUrl);
    if (pageTwoPartMatch?.[1]) {
      courseId = pageTwoPartMatch[1];
    } else {
      const pageOnePartMatch = /\/course\/([^/?]+)/.exec(pageUrl);
      if (pageOnePartMatch?.[1]) {
        courseId = pageOnePartMatch[1];
      }
    }

    if (!courseId) {
      console.error("Could not extract course ID from URL:", courseUrl);
      return null;
    }
  }

  // Extract URL slug for later URL construction
  const slugMatch = /\/course\/([^/]+)\/[^/]+/.exec(courseUrl);
  const courseSlug = slugMatch?.[1] ?? courseId;

  // Extract course details from DOM
  onProgress?.({ phase: "course" });

  const courseInfo = await page.evaluate(() => {
    // LearningSuite has the course title in a header section
    // The structure is: "KURS" label followed by the course name
    let title = "";

    // Look for elements containing "KURS" text and get the nearby title
    const allElements = document.querySelectorAll("*");
    for (const el of Array.from(allElements)) {
      const text = el.textContent?.trim() ?? "";
      if (text === "KURS" || text === "Kurs" || text === "COURSE") {
        // Found the label, now find the title (usually a sibling or nearby element)
        const parent = el.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children);
          for (const sib of siblings) {
            const sibText = sib.textContent?.trim() ?? "";
            if (sibText.length > 5 && sibText !== text && !sibText.includes("KURS")) {
              title = sibText;
              break;
            }
          }
        }
        if (title) break;
      }
    }

    // Alternative: find by URL slug
    if (!title) {
      const url = window.location.pathname;
      const slugMatch = /\/course\/([^/]+)\//.exec(url);
      if (slugMatch?.[1]) {
        // Convert slug to title (replace hyphens with spaces, title case)
        title = slugMatch[1].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      }
    }

    // Final fallback: page title
    if (!title) {
      title = document.title.split(" - ")[0]?.trim() ?? "Unknown Course";
    }

    return { title, description: null };
  });

  const course: LearningSuiteCourse = {
    id: courseId,
    title: courseInfo.title,
    description: courseInfo.description,
    thumbnailUrl: null,
    moduleCount: 0,
    lessonCount: 0,
  };

  onProgress?.({ phase: "course", courseName: course.title });

  // Extract modules and lessons from DOM
  onProgress?.({ phase: "modules" });

  // First try to extract modules directly from the course page
  let modulesWithLessons = await extractModulesFromCoursePage(page, domain, courseSlug, courseId);

  // If we found modules, try to get lessons for each by clicking on them
  if (modulesWithLessons.length > 0) {
    // Click on the first module to enter and get lessons
    const moduleCard = page.locator('[class*="module"], [class*="Module"]').first();
    if (await moduleCard.isVisible().catch(() => false)) {
      await moduleCard.click();
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(2000);
    }
  } else {
    // Try clicking on start button to enter the course
    const startButton = page
      .locator(
        'button:has-text("Jetzt anfangen"), button:has-text("Fortsetzen"), button:has-text("Start")'
      )
      .first();
    if (await startButton.isVisible().catch(() => false)) {
      await startButton.click();
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(2000);
    }
  }

  // Now look for "Übersicht" button to open the lessons panel
  const overviewButton = page
    .locator('button:has-text("Übersicht"), button:has-text("Overview")')
    .first();
  if (await overviewButton.isVisible().catch(() => false)) {
    await overviewButton.click();
    await page.waitForTimeout(2000);

    // Extract lessons from the overview dialog
    const lessonsFromOverview = await extractModulesAndLessonsFromDOM(
      page,
      domain,
      courseSlug,
      courseId
    );
    if (lessonsFromOverview.length > 0) {
      modulesWithLessons = lessonsFromOverview;
    }
  }

  // Close any open dialog
  await page.keyboard.press("Escape").catch(() => {});

  onProgress?.({ phase: "done" });

  // Update totals
  course.moduleCount = modulesWithLessons.length;
  course.lessonCount = modulesWithLessons.reduce((sum, m) => sum + m.lessons.length, 0);

  return {
    course,
    modules: modulesWithLessons,
    tenantId,
    domain,
    courseSlug,
  };
}

/**
 * Extracts modules and lessons from the overview dialog/sidebar.
 * The dialog shows:
 * - Header with module title + "X LEKTIONEN"
 * - Clickable lesson cards with thumbnails and titles
 */
async function extractModulesAndLessonsFromDOM(
  page: Page,
  _domain: string,
  _courseSlug: string,
  _courseId: string
): Promise<LearningSuiteCourseStructure["modules"]> {
  // Wait for dialog to be visible
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500); // Give time for content to render

  // Extract lesson data from the dialog
  const data = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return { moduleTitle: "", lessonCount: 0, lessons: [], moduleId: null };

    // Get module title and count from the header
    // The dialog header shows: "ModuleTitle" + "X LEKTIONEN"
    let moduleTitle = "";
    let lessonCount = 0;
    let moduleId: string | null = null;

    // The dialog content starts with header area containing title and count
    // Look for elements with text patterns
    const dialogText = dialog.textContent ?? "";

    // Extract lesson count first (e.g., "9 LEKTIONEN")
    const countMatch = /(\d+)\s*(?:LEKTION|Lektion)(?:EN)?/i.exec(dialogText);
    if (countMatch) {
      lessonCount = parseInt(countMatch[1] ?? "0", 10);
    }

    // Module title is typically the text before the lesson count
    // Find it by looking at the first text element in the dialog
    const firstTextElements = dialog.querySelectorAll("div > div > div:first-child *");
    for (const el of Array.from(firstTextElements)) {
      // Skip elements that contain nested elements with text
      if (el.children.length > 0 && el.querySelector("span, p, div")) continue;

      const text = el.textContent?.trim() ?? "";

      // Skip empty or too short
      if (text.length < 3) continue;

      // Skip if it's the lesson count
      if (/^\d+\s*(?:LEKTION|Lektion)/i.test(text)) continue;

      // Skip "X" close button
      if (text === "X" || text === "×") continue;

      // This should be the module title
      if (text.length >= 5 && text.length <= 100) {
        moduleTitle = text;
        break;
      }
    }

    // Find lesson cards - each card has an image (thumbnail) and title
    // We identify cards by looking for elements that contain exactly one image
    // and have reasonable dimensions
    const lessons: Array<{
      title: string;
      lessonId: string | null;
      moduleId: string | null;
    }> = [];

    // Get all images in the dialog (each lesson has a thumbnail)
    const images = dialog.querySelectorAll("img");
    const seenTitles = new Set<string>();

    for (const img of Array.from(images)) {
      // Find the card container (parent that contains both image and title)
      let card = img.parentElement;

      // Walk up to find the clickable card container
      while (card && card !== dialog) {
        const rect = card.getBoundingClientRect();
        // Card should be roughly 300-600px wide and 60-120px tall
        if (rect.width >= 250 && rect.width <= 650 && rect.height >= 50 && rect.height <= 150) {
          break;
        }
        card = card.parentElement;
      }

      if (!card || card === dialog) continue;

      // Get the text content of the card, excluding nested card text
      // The title is usually in a sibling element to the image
      let title = "";

      // Try to find title text - look for text nodes near the image
      const textNodes = card.querySelectorAll("span, p, div");
      for (const textNode of Array.from(textNodes)) {
        // Skip if this contains the image
        if (textNode.querySelector("img")) continue;

        const text = textNode.textContent?.trim() ?? "";

        // Skip very short or very long text
        if (text.length < 5 || text.length > 80) continue;

        // Skip if it contains the module title + lesson count
        if (text.includes("LEKTION")) continue;
        if (text === moduleTitle) continue;

        // This is likely the title
        title = text;
        break;
      }

      // If no title found in children, use card's direct text
      if (!title) {
        const cardText = card.textContent?.trim() ?? "";
        // Extract just the title part (remove any "X LEKTIONEN" or module title)
        const cleaned = cardText
          .replace(moduleTitle, "")
          .replace(/\d+\s*(?:LEKTION|Lektion)(?:EN)?/gi, "")
          .trim();
        if (cleaned.length >= 5 && cleaned.length <= 80) {
          title = cleaned;
        }
      }

      if (!title || seenTitles.has(title)) continue;

      // Extract IDs from URL if card is clickable
      let lessonId: string | null = null;
      let cardModuleId: string | null = null;

      const clickable = card.closest("a[href], [onclick]") ?? card.querySelector("a[href]");
      if (clickable) {
        const href =
          (clickable as HTMLAnchorElement).href ?? clickable.getAttribute("onclick") ?? "";
        const parts = href.split("/").filter(Boolean);
        if (parts.length >= 6) {
          cardModuleId = parts[4] ?? null;
          lessonId = parts[5] ?? null;
        }
      }

      // Use first module ID found
      if (!moduleId && cardModuleId) {
        moduleId = cardModuleId;
      }

      seenTitles.add(title);
      lessons.push({
        title,
        lessonId: lessonId ?? `lesson-${lessons.length}`,
        moduleId: cardModuleId,
      });
    }

    return { moduleTitle, lessonCount, lessons, moduleId };
  });

  // If no lessons found, return empty
  if (data.lessons.length === 0) {
    return [];
  }

  // Create module with lessons
  const moduleId = data.moduleId ?? "module-0";

  return [
    {
      id: moduleId,
      title: data.moduleTitle || "Module",
      description: `${data.lessonCount} Lektionen`,
      position: 0,
      isLocked: false,
      lessons: data.lessons.map((l, idx) => ({
        id: l.lessonId ?? `lesson-${idx}`,
        title: l.title,
        position: idx,
        moduleId: moduleId,
        isLocked: false,
        isCompleted: false,
      })),
    },
  ];
}

/**
 * Extracts modules from the course page by analyzing module cards.
 * Module cards have a specific structure with title and "X LEKTIONEN | Y MIN."
 */
async function extractModulesFromCoursePage(
  page: Page,
  _domain: string,
  _courseSlug: string,
  _courseId: string
): Promise<LearningSuiteCourseStructure["modules"]> {
  // Wait for modules section to load
  await page.waitForTimeout(1000);

  // Extract module cards from the page using a more targeted approach
  const modulesData = await page.evaluate(() => {
    const modules: Array<{
      title: string;
      lessonCount: number;
      duration: string;
      href: string | null;
      moduleId: string | null;
    }> = [];

    // Find elements that contain the module pattern "X LEKTIONEN | Y MIN."
    // These are typically card-like elements
    const pattern = /^(.+?)\s*(\d+)\s*(?:LEKTION|Lektion)(?:EN)?\s*\|\s*(\d+)\s*MIN\.*$/i;

    // Look for cards with this pattern
    const candidates = document.querySelectorAll("div, a");
    const seen = new Set<string>();

    for (const el of Array.from(candidates)) {
      // Get the element's text content
      const textContent = el.textContent?.trim() ?? "";

      // The element must contain "LEKTIONEN" and "MIN" pattern
      if (!textContent.includes("LEKTION") || !textContent.includes("MIN")) continue;

      // Element should be reasonably sized (a card)
      const rect = el.getBoundingClientRect();
      if (rect.width < 100 || rect.height < 50) continue;
      if (rect.width > 800) continue; // Skip if too wide (probably a container)

      // Extract info using regex
      const match = pattern.exec(textContent);
      if (!match) continue;

      const title = match[1]?.trim() ?? "";
      const lessonCount = parseInt(match[2] ?? "0", 10);
      const duration = match[3] + " Min.";

      // Skip if title is too short or already seen
      if (title.length < 3 || seen.has(title)) continue;
      seen.add(title);

      // Get href
      const linkEl = el.closest("a") ?? el.querySelector("a");
      const href = linkEl?.getAttribute("href") ?? null;

      // Extract module ID from href
      let moduleId: string | null = null;
      if (href) {
        const parts = href.split("/").filter(Boolean);
        if (parts.length >= 5) {
          moduleId = parts[4] ?? null;
        }
      }

      modules.push({ title, lessonCount, duration, href, moduleId });
    }

    return modules;
  });

  const modules: LearningSuiteCourseStructure["modules"] = [];

  for (let i = 0; i < modulesData.length; i++) {
    const mod = modulesData[i];
    if (!mod) continue;

    modules.push({
      id: mod.moduleId ?? `module-${i}`,
      title: mod.title,
      description: `${mod.lessonCount} Lektionen, ${mod.duration}`,
      position: i,
      isLocked: false,
      lessons: [], // Will be populated when we enter the module
    });
  }

  return modules;
}
/* v8 ignore stop */

// ============================================================================
// URL Utilities
// ============================================================================

/**
 * Constructs the URL for a LearningSuite course.
 */
export function getLearningSuiteCourseUrl(
  domain: string,
  courseSlug: string,
  courseId: string
): string {
  return `https://${domain}/student/course/${courseSlug}/${courseId}`;
}

/**
 * Constructs the URL for a LearningSuite lesson.
 * URL format: /student/course/{slug}/{courseId}/{moduleId}/{lessonId}
 */
export function getLearningSuiteLessonUrl(
  domain: string,
  courseSlug: string,
  courseId: string,
  moduleId: string,
  lessonId: string
): string {
  return `https://${domain}/student/course/${courseSlug}/${courseId}/${moduleId}/${lessonId}`;
}

// Re-export shared utilities
export { slugify, createFolderName } from "../../shared/slug.js";
