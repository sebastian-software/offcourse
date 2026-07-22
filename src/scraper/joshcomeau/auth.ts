import type { Page } from "playwright";
import type { AuthVerificationOptions } from "../../shared/auth.js";
import { isJoshComeauCourseUrl, normalizeJoshComeauCourseUrl } from "./navigator.js";

export const JOSH_COMEAU_DOMAIN = "courses.joshwcomeau.com";
export const JOSH_COMEAU_LOGIN_URL = "https://courses.joshwcomeau.com/";

export function isJoshComeauLoginPage(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === JOSH_COMEAU_DOMAIN && parsed.pathname.startsWith("/api/auth/");
  } catch {
    return false;
  }
}

export interface JoshComeauAccessIndicators {
  heading: string;
  hasDashboardCard: boolean;
  hasCurriculum: boolean;
  hasUnlockedLesson: boolean;
  bodyText: string;
}

/** Distinguishes purchased course access from the public curriculum preview. */
export function hasJoshComeauCourseAccess(indicators: JoshComeauAccessIndicators): boolean {
  if (indicators.heading === "My Dashboard" && indicators.hasDashboardCard) return true;
  if (indicators.hasUnlockedLesson) return true;

  const hasAccessWall = /\b(?:register for|to unlock this course)\b/i.test(indicators.bodyText);
  return indicators.hasCurriculum && !hasAccessWall;
}

async function pageHasCourseAccess(page: Page): Promise<boolean> {
  if (page.isClosed() || new URL(page.url()).hostname !== JOSH_COMEAU_DOMAIN) return false;
  const indicators = await page.evaluate(() => ({
    heading: document.querySelector("main h1")?.textContent?.trim() ?? "",
    hasDashboardCard: document.querySelector('[data-test="course-card"]') !== null,
    hasCurriculum: document.querySelector('a[data-test="module-lesson-anchor"]') !== null,
    hasUnlockedLesson: document.querySelector('[data-test="unlocked-content"]') !== null,
    bodyText: document.body.textContent ?? "",
  }));
  return hasJoshComeauCourseAccess(indicators);
}

/**
 * Verifies cached sessions and also watches for a Magic Link opened in another
 * tab of the same Playwright browser context.
 */
export function createJoshComeauSessionVerifier(
  courseUrl?: string
): (page: Page, options?: AuthVerificationOptions) => Promise<boolean> {
  const targetUrl =
    courseUrl && isJoshComeauCourseUrl(courseUrl)
      ? normalizeJoshComeauCourseUrl(courseUrl)
      : JOSH_COMEAU_LOGIN_URL;

  return async (page: Page, options: AuthVerificationOptions = {}): Promise<boolean> => {
    const contextPages = [...page.context().pages()].reverse();
    for (const candidate of contextPages) {
      if (await pageHasCourseAccess(candidate)) return true;
    }

    if (options.allowNavigation !== false && page.url() !== targetUrl) {
      await page.goto(targetUrl, { timeout: 30000 });
      await page.waitForLoadState("domcontentloaded");
    }
    return pageHasCourseAccess(page);
  };
}
