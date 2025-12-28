import type { BrowserContext, Page } from "playwright";
import {
  safeParse,
  CourseSchema,
  ModuleSchema,
  LessonSchema,
  type Course,
  type Module,
  type Lesson,
} from "./schemas.js";
import { parallelProcess } from "../../shared/parallelWorker.js";

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
  phase: "init" | "navigating" | "extracting" | "course" | "modules" | "lessons" | "done";
  /** Status message for the current phase */
  status?: string;
  courseName?: string;
  totalModules?: number;
  currentModule?: string;
  currentModuleIndex?: number;
  lessonsFound?: number;
  skippedLocked?: boolean;
  /** Number of modules processed so far (for parallel scanning) */
  modulesProcessed?: number;
}

/**
 * Options for course structure building.
 */
export interface BuildLearningSuiteOptions {
  /** Browser context for creating parallel worker tabs */
  context?: BrowserContext;
  /** Number of parallel workers for scanning modules (default: 1 = sequential) */
  concurrency?: number;
  /** Check if scanning should stop early (e.g., shutdown signal) */
  shouldContinue?: () => boolean;
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
 * Dismisses any open MUI modal dialogs that might block interactions.
 * These are notification/welcome modals that appear dynamically.
 */
async function dismissMuiDialogs(page: Page): Promise<void> {
  try {
    // Check if there's an open MUI dialog
    const dialog = page.locator('[role="presentation"].MuiDialog-root, .MuiModal-root');
    if (await dialog.isVisible({ timeout: 500 }).catch(() => false)) {
      // Try different ways to close the dialog:

      // 1. Press Escape key (most reliable)
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);

      // Check if still visible
      if (await dialog.isVisible({ timeout: 200 }).catch(() => false)) {
        // 2. Try clicking the backdrop/overlay
        const backdrop = page.locator(".MuiBackdrop-root, .MuiDialog-container");
        if (await backdrop.isVisible({ timeout: 200 }).catch(() => false)) {
          // Click outside the dialog content
          await page.mouse.click(10, 10);
          await page.waitForTimeout(300);
        }
      }

      // Check again and try close button
      if (await dialog.isVisible({ timeout: 200 }).catch(() => false)) {
        // 3. Try clicking a close button if present
        const closeBtn = page.locator(
          '[aria-label="close"], [aria-label="Close"], .MuiDialogTitle-root button, .MuiIconButton-root'
        );
        if (
          await closeBtn
            .first()
            .isVisible({ timeout: 200 })
            .catch(() => false)
        ) {
          await closeBtn
            .first()
            .click({ timeout: 1000 })
            .catch(() => {});
          await page.waitForTimeout(300);
        }
      }
    }
  } catch {
    // Ignore errors - dialog might have closed naturally
  }
}

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
    // Note: LearningSuite uses persisted queries, so most custom queries will fail with HTTP 400.
    // This is expected behavior - we fall back to DOM-based extraction.
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
 * Scans a single module for lessons by navigating to it.
 * This is extracted to allow parallel processing.
 */
async function scanModuleLessons(
  page: Page,
  module: LearningSuiteCourseStructure["modules"][0],
  courseUrl: string,
  courseId: string
): Promise<LearningSuiteCourseStructure["modules"][0]> {
  // Navigate to course page first (each worker starts fresh)
  await page.goto(courseUrl, { timeout: 30000 });
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(2000);

  // Dismiss any modal dialogs
  await dismissMuiDialogs(page);

  // Navigate to the module by clicking on its title text
  const moduleTitle = page.locator(`text="${module.title}"`).first();

  if (!(await moduleTitle.isVisible().catch(() => false))) {
    return module; // Return unchanged if not visible
  }

  // Dismiss any modal dialogs that might block the click
  await dismissMuiDialogs(page);
  await moduleTitle.click();
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(2000);

  // Extract module ID from URL (format: /t/{moduleId})
  const currentUrl = page.url();
  const moduleIdMatch = /\/t\/([^/]+)/.exec(currentUrl);
  const moduleId = moduleIdMatch?.[1] ?? module.id;

  // Extract lessons directly from the module page
  const lessonsData = await page.evaluate((cId) => {
    const links = document.querySelectorAll("a");
    const lessons: {
      title: string;
      lessonId: string;
      duration: string;
      isCompleted: boolean;
    }[] = [];
    const seenIds = new Set<string>();

    for (const link of Array.from(links)) {
      const href = link.href;

      // Check if this is a lesson link (contains courseId but not /t/)
      if (!href.includes(`/${cId}/`) || href.includes("/t/")) continue;

      // Extract lesson ID from URL
      const parts = href.split("/");
      const lessonId = parts[parts.length - 1];
      if (!lessonId || seenIds.has(lessonId)) continue;
      seenIds.add(lessonId);

      // Extract title and duration from link text
      const text = link.textContent?.replace(/\s+/g, " ").trim() ?? "";
      if (text.length < 5) continue;

      // Parse title (before duration info)
      let title = text;
      let duration = "";

      // Duration patterns: "X Minute(n)" or "X Sekunde(n)"
      const durationMatch = /(\d+\s*(?:Minute|Sekunde)n?)/i.exec(text);
      if (durationMatch) {
        const durationIdx = text.indexOf(durationMatch[0]);
        title = text.substring(0, durationIdx).trim();
        duration = durationMatch[0];
      }

      // Check for completion checkmark
      const hasCheckmark = link.querySelector('svg[data-icon="check"]') !== null;

      if (title.length > 3) {
        lessons.push({ title, lessonId, duration, isCompleted: hasCheckmark });
      }
    }

    return lessons;
  }, courseId);

  return {
    ...module,
    id: moduleId,
    lessons: lessonsData.map((l, idx) => ({
      id: l.lessonId,
      title: l.title,
      position: idx,
      moduleId,
      isLocked: false,
      isCompleted: l.isCompleted,
    })),
  };
}

/**
 * Builds the complete course structure for a LearningSuite course using DOM extraction.
 * This is more reliable than GraphQL as the API structure may vary between instances.
 *
 * @param page - Main page for initial navigation
 * @param courseUrl - URL of the course
 * @param onProgress - Progress callback
 * @param options - Options for parallel processing
 */
export async function buildLearningSuiteCourseStructure(
  page: Page,
  courseUrl: string,
  onProgress?: (progress: LearningSuiteScanProgress) => void,
  options?: BuildLearningSuiteOptions
): Promise<LearningSuiteCourseStructure | null> {
  const { context, concurrency = 1, shouldContinue = () => true } = options ?? {};

  // Extract domain and tenant info
  const urlObj = new URL(courseUrl);
  const domain = urlObj.hostname;

  onProgress?.({ phase: "init" });

  // Navigate to course page
  onProgress?.({ phase: "navigating", status: "Loading course page..." });
  await page.goto(courseUrl, { timeout: 30000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(3000);

  // Dismiss any modal dialogs (e.g., welcome/notification modals)
  await dismissMuiDialogs(page);

  // Extract tenant ID from page
  onProgress?.({ phase: "extracting", status: "Extracting tenant info..." });
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
  onProgress?.({ phase: "extracting", status: "Reading course details..." });

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
  onProgress?.({ phase: "extracting", status: "Finding modules..." });

  // First extract all modules from the course page
  const initialModules = await extractModulesFromCoursePage(page, domain, courseSlug, courseId);

  // Filter accessible modules (not locked)
  const accessibleModules = initialModules.filter((m) => !m.isLocked);
  const lockedModules = initialModules.filter((m) => m.isLocked);

  // Report total counts (accessible modules for progress bar)
  onProgress?.({
    phase: "modules",
    totalModules: accessibleModules.length,
  });

  // Report locked modules (just for info, not counted in progress)
  for (const module of lockedModules) {
    onProgress?.({
      phase: "lessons",
      currentModule: module.title,
      skippedLocked: true,
    });
  }

  // Use parallel processing if context is provided and concurrency > 1
  const useParallel = context && concurrency > 1 && accessibleModules.length > 1;

  let scannedModules: LearningSuiteCourseStructure["modules"] = [];

  if (useParallel) {
    // Parallel scanning with worker tabs
    let processed = 0;

    const { results } = await parallelProcess(
      context,
      page,
      accessibleModules,
      async (workerPage, module, _index) => {
        const scannedModule = await scanModuleLessons(workerPage, module, courseUrl, courseId);

        processed++;
        onProgress?.({
          phase: "lessons",
          currentModule: module.title,
          modulesProcessed: processed,
          totalModules: accessibleModules.length,
          lessonsFound: scannedModule.lessons.length,
        });

        return scannedModule;
      },
      { concurrency, shouldContinue }
    );

    scannedModules = results;
  } else {
    // Sequential scanning (original behavior)
    for (let i = 0; i < accessibleModules.length; i++) {
      const module = accessibleModules[i];
      if (!module || !shouldContinue()) break;

      onProgress?.({
        phase: "modules",
        currentModuleIndex: i + 1,
        totalModules: accessibleModules.length,
        currentModule: module.title,
      });

      // Navigate to the module by clicking on its title text
      const moduleTitle = page.locator(`text="${module.title}"`).first();

      if (await moduleTitle.isVisible().catch(() => false)) {
        // Dismiss any modal dialogs that might block the click
        await dismissMuiDialogs(page);
        await moduleTitle.click();
        await page.waitForLoadState("domcontentloaded").catch(() => {});
        await page.waitForTimeout(2000);

        // Extract module ID from URL (format: /t/{moduleId})
        const currentUrl = page.url();
        const moduleIdMatch = /\/t\/([^/]+)/.exec(currentUrl);
        if (moduleIdMatch?.[1]) {
          module.id = moduleIdMatch[1];
        }

        // Extract lessons directly from the module page
        const lessonsData = await page.evaluate((cId) => {
          const links = document.querySelectorAll("a");
          const lessons: {
            title: string;
            lessonId: string;
            duration: string;
            isCompleted: boolean;
          }[] = [];
          const seenIds = new Set<string>();

          for (const link of Array.from(links)) {
            const href = link.href;

            // Check if this is a lesson link (contains courseId but not /t/)
            if (!href.includes(`/${cId}/`) || href.includes("/t/")) continue;

            // Extract lesson ID from URL
            const parts = href.split("/");
            const lessonId = parts[parts.length - 1];
            if (!lessonId || seenIds.has(lessonId)) continue;
            seenIds.add(lessonId);

            // Extract title and duration from link text
            const text = link.textContent?.replace(/\s+/g, " ").trim() ?? "";
            if (text.length < 5) continue;

            // Parse title (before duration info)
            let title = text;
            let duration = "";

            // Duration patterns: "X Minute(n)" or "X Sekunde(n)"
            const durationMatch = /(\d+\s*(?:Minute|Sekunde)n?)/i.exec(text);
            if (durationMatch) {
              const durationIdx = text.indexOf(durationMatch[0]);
              title = text.substring(0, durationIdx).trim();
              duration = durationMatch[0];
            }

            // Check for completion checkmark
            const hasCheckmark = link.querySelector('svg[data-icon="check"]') !== null;

            if (title.length > 3) {
              lessons.push({ title, lessonId, duration, isCompleted: hasCheckmark });
            }
          }

          return lessons;
        }, courseId);

        if (lessonsData.length > 0) {
          module.lessons = lessonsData.map((l, idx) => ({
            id: l.lessonId,
            title: l.title,
            position: idx,
            moduleId: module.id,
            isLocked: false,
            isCompleted: l.isCompleted,
          }));
        }

        onProgress?.({
          phase: "lessons",
          currentModule: module.title,
          currentModuleIndex: i + 1,
          lessonsFound: module.lessons.length,
        });

        // Go back to the course page
        await page.goto(courseUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
        await page.waitForTimeout(1500);

        // Dismiss any modal dialogs that appeared
        await dismissMuiDialogs(page);
      }

      scannedModules.push(module);
    }
  }

  // Combine locked and scanned modules (maintain original order)
  const allModules = initialModules.map((m) => {
    if (m.isLocked) return m;
    return scannedModules.find((s) => s.title === m.title) ?? m;
  });

  onProgress?.({ phase: "done" });

  // Update totals
  course.moduleCount = allModules.length;
  course.lessonCount = allModules.reduce((sum, m) => sum + m.lessons.length, 0);

  return {
    course,
    modules: allModules,
    tenantId,
    domain,
    courseSlug,
  };
}

/**
 * Extracts modules from the course page by analyzing text content.
 * Modules are identified by their stats line: "X LEKTIONEN | Y MIN." or "ERSCHEINT BALD"
 */
async function extractModulesFromCoursePage(
  page: Page,
  _domain: string,
  _courseSlug: string,
  _courseId: string
): Promise<LearningSuiteCourseStructure["modules"]> {
  // Wait for content to load
  await page.waitForTimeout(2000);

  // Extract modules by analyzing text content
  const modulesData = await page.evaluate(() => {
    const text = document.body.innerText;
    const lines = text
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const modules: {
      title: string;
      lessonCount: number;
      duration: string;
      isLocked: boolean;
    }[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";

      // Check for stats line pattern
      const statsMatch = /(\d+)\s*LEKTIONEN?\s*\|\s*(\d+)\s*MIN/i.exec(line);
      const isLocked = /ERSCHEINT\s*BALD|COMING\s*SOON/i.test(line);

      if (statsMatch || isLocked) {
        // The title is usually the line before the stats
        const prevLine = lines[i - 1]?.trim() ?? "";

        // Validate title
        if (
          prevLine &&
          prevLine.length > 3 &&
          prevLine.length < 100 &&
          !/^(\d+%|START|FORTSETZEN)$/i.test(prevLine)
        ) {
          modules.push({
            title: prevLine,
            lessonCount: statsMatch ? parseInt(statsMatch[1] ?? "0", 10) : 0,
            duration: statsMatch ? (statsMatch[2] ?? "0") + " Min." : "",
            isLocked,
          });
        }
      }
    }

    return modules;
  });

  const modules: LearningSuiteCourseStructure["modules"] = [];

  for (let i = 0; i < modulesData.length; i++) {
    const mod = modulesData[i];
    if (!mod) continue;

    const description = mod.isLocked
      ? "Erscheint bald"
      : `${mod.lessonCount} Lektionen, ${mod.duration}`;

    modules.push({
      id: `module-${i}`, // Will be updated when we navigate to the module
      title: mod.title,
      description,
      position: i,
      isLocked: mod.isLocked,
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
 * URL format: /student/course/{slug}/{courseId}/{topicId}
 * Note: The topicId (lessonId from module page) is enough - the server redirects to the full URL.
 */
export function getLearningSuiteLessonUrl(
  domain: string,
  courseSlug: string,
  courseId: string,
  _moduleId: string, // Unused - kept for API compatibility
  lessonId: string // This is actually the topicId
): string {
  return `https://${domain}/student/course/${courseSlug}/${courseId}/${lessonId}`;
}

// ============================================================================
// Lesson Completion
// ============================================================================
/* v8 ignore start */

/**
 * Marks a lesson as completed by clicking the "Abschließen" button.
 * This unlocks the next lesson in sequence.
 *
 * @returns true if successfully completed, false otherwise
 */
export async function markLessonComplete(page: Page, lessonUrl: string): Promise<boolean> {
  try {
    // Dismiss any modal dialogs first
    await dismissMuiDialogs(page);

    // Navigate to the lesson if not already there
    const currentUrl = page.url();
    if (!currentUrl.includes(lessonUrl)) {
      await page.goto(lessonUrl, { timeout: 30000 });
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(2000);

      // Dismiss any dialogs that appeared after navigation
      await dismissMuiDialogs(page);
    }

    // Find and click the complete button using evaluate
    // (handles font rendering issues where "Abschließen" might appear as "Ab chließen")
    const clicked = await page.evaluate(() => {
      // Look for buttons with text containing variations of "Abschließen" or "Complete"
      const buttons = Array.from(document.querySelectorAll("button"));

      for (const button of buttons) {
        const text = button.textContent?.toLowerCase().replace(/\s+/g, "") ?? "";
        // Match: abschließen, abschliessen, complete, markascomplete
        if (
          text.includes("abschließen") ||
          text.includes("abschliessen") ||
          text.includes("complete")
        ) {
          // Check if this is not already a "completed" state button
          if (!text.includes("abgeschlossen") && !text.includes("completed")) {
            button.click();
            return true;
          }
        }
      }
      return false;
    });

    if (!clicked) {
      return false;
    }

    // Wait for the API call to complete
    await page.waitForTimeout(1500);

    // If we clicked the button, consider it successful
    // The server tracks completion via submitEventsNew GraphQL mutation
    return true;
  } catch (error) {
    console.error("Error marking lesson as complete:", error);
    return false;
  }
}

/**
 * Auto-completes all accessible lessons in sequence to unlock subsequent content.
 * This is useful when lessons are sequentially locked.
 *
 * @param page - Playwright page
 * @param lessons - List of lessons to complete
 * @param onProgress - Callback for progress updates
 * @returns Number of lessons successfully completed
 */
export async function autoCompleteLessons(
  page: Page,
  lessons: { url: string; title: string; isLocked: boolean }[],
  onProgress?: (completed: number, total: number, currentLesson: string) => void
): Promise<number> {
  let completedCount = 0;
  const unlocked = lessons.filter((l) => !l.isLocked);

  for (const lesson of unlocked) {
    onProgress?.(completedCount, unlocked.length, lesson.title);

    const success = await markLessonComplete(page, lesson.url);
    if (success) {
      completedCount++;
    } else {
      // If we can't complete a lesson, subsequent ones might still be locked
      console.warn(`Could not complete lesson: ${lesson.title}`);
    }

    // Small delay between lessons
    await page.waitForTimeout(500);
  }

  return completedCount;
}

/**
 * Checks if a lesson page shows the lesson as completed.
 */
export async function isLessonCompleted(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    // Look for completion indicators
    const indicators = [
      '[class*="completed"]',
      '[class*="done"]',
      '[data-completed="true"]',
      'button:has-text("Abgeschlossen")',
    ];

    for (const selector of indicators) {
      if (document.querySelector(selector)) return true;
    }

    // Check if "Abschließen" button is gone or disabled
    const completeButton = document.querySelector(
      'button:has-text("Abschließen"), button:has-text("Complete")'
    );
    if (completeButton) {
      return (completeButton as HTMLButtonElement).disabled;
    }

    return false;
  });
}
/* v8 ignore stop */

// Re-export shared utilities
export { slugify, createFolderName } from "../../shared/slug.js";
