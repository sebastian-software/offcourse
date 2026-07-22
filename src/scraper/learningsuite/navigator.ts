import type { BrowserContext, Locator, Page } from "playwright";
import { parallelProcess } from "../../shared/parallelWorker.js";

const KNOWN_MODULE_STATS_PATTERN =
  /(\d+)\s*(?:LEKTION(?:EN)?|LESSONS?)\s*\|\s*(\d+)\s*(?:MIN(?:\.|S)?|MINUTEN?|MINUTES?)/i;
const GENERIC_MODULE_STATS_PATTERN = /(\d+)\s+\p{L}+\s*\|\s*(\d+)\s+\p{L}+/iu;

/** Returns a stable local identity for a module before LearningSuite exposes its remote ID. */
export function getLearningSuiteModuleSlug(position: number, title: string): string {
  let hash = 2166136261;
  for (const character of title.trim().normalize("NFKC").toLowerCase()) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `module-${position}-${(hash >>> 0).toString(36)}`;
}

export async function waitForLearningSuiteModules(page: Page): Promise<void> {
  await page
    .waitForFunction(
      () =>
        /(\d+)\s*(?:LEKTION(?:EN)?|LESSONS?)\s*\|\s*(\d+)\s*(?:MIN(?:\.|S)?|MINUTEN?|MINUTES?)|\d+\s+\p{L}+\s*\|\s*\d+\s+\p{L}+|ERSCHEINT\s*BALD|COMING\s*SOON/iu.test(
          document.body.innerText
        ),
      undefined,
      { timeout: 5000 }
    )
    .catch(() => {});
}

export async function waitForLearningSuiteLessons(page: Page, courseId: string): Promise<void> {
  await page
    .waitForFunction(
      (id) =>
        Array.from(document.querySelectorAll("a")).some(
          (link) => link.href.includes(`/${id}/`) && !link.href.includes("/t/")
        ),
      courseId,
      { timeout: 5000 }
    )
    .catch(() => {});
}

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
  /** Accessible modules that were scanned but yielded no lessons. */
  emptyModuleTitles?: string[];
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

interface ParsedLearningSuiteModule {
  title: string;
  lessonCount: number;
  duration: string;
  isLocked: boolean;
}

interface ParsedLearningSuiteLessonText {
  title: string;
  duration: string;
}

/**
 * Parses LearningSuite's localized module summary text.
 */
export function parseLearningSuiteModulesText(text: string): ParsedLearningSuiteModule[] {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const modules: ParsedLearningSuiteModule[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const statsMatch =
      KNOWN_MODULE_STATS_PATTERN.exec(line) ?? GENERIC_MODULE_STATS_PATTERN.exec(line);
    const isLocked = /ERSCHEINT\s*BALD|COMING\s*SOON/i.test(line);

    if (!statsMatch && !isLocked) continue;

    const title = lines[i - 1]?.trim() ?? "";
    if (
      !title ||
      title.length <= 3 ||
      title.length >= 100 ||
      /^(\d+%|START|FORTSETZEN|CONTINUE)$/i.test(title)
    ) {
      continue;
    }

    modules.push({
      title,
      lessonCount: statsMatch ? parseInt(statsMatch[1] ?? "0", 10) : 0,
      duration: statsMatch ? `${statsMatch[2] ?? "0"} Min.` : "",
      isLocked,
    });
  }

  return modules;
}

/**
 * Removes localized duration metadata from a lesson link's visible text.
 */
export function parseLearningSuiteLessonText(text: string): ParsedLearningSuiteLessonText | null {
  const normalizedText = text.replace(/\s+/g, " ").trim();
  if (normalizedText.length < 5) return null;

  const durationMatch = /(\d+\s*(?:Minuten?|Sekunden?|Minutes?|Seconds?))\b/i.exec(normalizedText);
  const title = durationMatch
    ? normalizedText.substring(0, durationMatch.index).trim()
    : normalizedText;

  if (title.length <= 3) return null;

  return {
    title,
    duration: durationMatch?.[0] ?? "",
  };
}

// ============================================================================
// Browser/API Automation
// ============================================================================

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
      await dialog.waitFor({ state: "hidden", timeout: 500 }).catch(() => {});

      // Check if still visible
      if (await dialog.isVisible({ timeout: 200 }).catch(() => false)) {
        // 2. Try clicking the backdrop/overlay
        const backdrop = page.locator(".MuiBackdrop-root, .MuiDialog-container");
        if (await backdrop.isVisible({ timeout: 200 }).catch(() => false)) {
          // Click outside the dialog content
          await page.mouse.click(10, 10);
          await dialog.waitFor({ state: "hidden", timeout: 500 }).catch(() => {});
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
          await dialog.waitFor({ state: "hidden", timeout: 500 }).catch(() => {});
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
 * Scans a single module for lessons by navigating to it.
 * This is extracted to allow parallel processing.
 */
async function scanModuleLessons(
  page: Page,
  module: LearningSuiteCourseStructure["modules"][0],
  courseUrl: string,
  courseId: string,
  titleOccurrence: number
): Promise<LearningSuiteCourseStructure["modules"][0]> {
  // Navigate to course page first (each worker starts fresh)
  await page.goto(courseUrl, { timeout: 30000 });
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await waitForLearningSuiteModules(page);

  // Dismiss any modal dialogs
  await dismissMuiDialogs(page);

  // Navigate to the module by clicking its title inside the module-card container.
  const moduleTitle = await findLearningSuiteModuleTitle(page, module.title, titleOccurrence);
  await moduleTitle.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});

  if (!(await moduleTitle.isVisible().catch(() => false))) {
    console.warn(`Skipping LearningSuite module "${module.title}": title is not visible`);
    return module; // Return unchanged if not visible
  }

  // Dismiss any modal dialogs that might block the click
  await dismissMuiDialogs(page);
  await moduleTitle.click();
  await page.waitForURL(/\/t\/[^/]+/, { timeout: 5000 }).catch(() => {});
  await waitForLearningSuiteLessons(page, courseId);

  // Extract module ID from URL (format: /t/{moduleId})
  const currentUrl = page.url();
  const moduleIdMatch = /\/t\/([^/]+)/.exec(currentUrl);
  const moduleId = moduleIdMatch?.[1] ?? module.id;

  // Extract lessons directly from the module page
  const lessonCandidates = await page.evaluate((cId) => {
    const links = document.querySelectorAll("a");
    const lessons: {
      text: string;
      lessonId: string;
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

      // Preserve visible text for localized parsing outside the browser context.
      const text = link.textContent?.replace(/\s+/g, " ").trim() ?? "";
      if (text.length < 5) continue;

      // Check for completion checkmark
      const hasCheckmark = link.querySelector('svg[data-icon="check"]') !== null;
      lessons.push({ text, lessonId, isCompleted: hasCheckmark });
    }

    return lessons;
  }, courseId);

  const lessonsData = lessonCandidates.flatMap((lesson) => {
    const parsedText = parseLearningSuiteLessonText(lesson.text);
    return parsedText ? [{ ...lesson, ...parsedText }] : [];
  });

  return {
    ...module,
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
 * Finds a module title inside a module-card container before applying the occurrence index.
 * LearningSuite pages can repeat a module title in hero/continue cards elsewhere on the page.
 */
async function findLearningSuiteModuleTitle(
  page: Page,
  title: string,
  occurrence: number
): Promise<Locator> {
  const exactTitle = page.getByText(title, { exact: true });
  const cardSelectors = [
    'a[href*="/t/"]',
    '[data-testid*="module" i]',
    '[class*="module" i]',
    '[class*="card" i]',
    "article",
  ];

  for (const selector of cardSelectors) {
    const cards = page.locator(selector).filter({ has: exactTitle });
    if ((await cards.count()) > occurrence) {
      return cards.nth(occurrence).getByText(title, { exact: true }).first();
    }
  }

  return exactTitle.nth(occurrence);
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
  await waitForLearningSuiteModules(page);

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

  if (initialModules.length === 0) {
    console.error(
      "Could not find any LearningSuite modules on the course page; refusing to save an empty course"
    );
    return null;
  }

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
      async (workerPage, module) => {
        const titleOccurrence = initialModules
          .slice(0, module.position)
          .filter((candidate) => candidate.title === module.title).length;
        const scannedModule = await scanModuleLessons(
          workerPage,
          module,
          courseUrl,
          courseId,
          titleOccurrence
        );

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

      const titleOccurrence = initialModules
        .slice(0, module.position)
        .filter((candidate) => candidate.title === module.title).length;
      const scannedModule = await scanModuleLessons(
        page,
        module,
        courseUrl,
        courseId,
        titleOccurrence
      );

      onProgress?.({
        phase: "lessons",
        currentModule: module.title,
        currentModuleIndex: i + 1,
        lessonsFound: scannedModule.lessons.length,
      });

      scannedModules.push(scannedModule);
    }
  }

  // Combine locked and scanned modules (maintain original order)
  const allModules = initialModules.map((m) => {
    if (m.isLocked) return m;
    return scannedModules.find((s) => s.position === m.position) ?? m;
  });

  onProgress?.({ phase: "done" });

  // Update totals
  course.moduleCount = allModules.length;
  course.lessonCount = allModules.reduce((sum, m) => sum + m.lessons.length, 0);
  const emptyModuleTitles = scannedModules
    .filter((module) => module.lessons.length === 0)
    .map((module) => module.title);

  return {
    course,
    modules: allModules,
    tenantId,
    domain,
    courseSlug,
    emptyModuleTitles,
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
  // Extract modules by analyzing localized text content.
  const pageText = await page.evaluate(() => document.body.innerText);
  const modulesData = parseLearningSuiteModulesText(pageText);

  const modules: LearningSuiteCourseStructure["modules"] = [];

  for (let i = 0; i < modulesData.length; i++) {
    const mod = modulesData[i];
    if (!mod) continue;

    const description = mod.isLocked
      ? "Erscheint bald"
      : `${mod.lessonCount} Lektionen, ${mod.duration}`;

    modules.push({
      id: getLearningSuiteModuleSlug(i, mod.title),
      title: mod.title,
      description,
      position: i,
      isLocked: mod.isLocked,
      lessons: [], // Will be populated when we enter the module
    });
  }

  return modules;
}

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

// Re-export shared utilities
export { slugify, createFolderName } from "../../shared/slug.js";
