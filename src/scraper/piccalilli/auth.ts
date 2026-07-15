import type { Page } from "playwright";
import { normalizePiccalilliCourseUrl } from "./navigator.js";

export const PICCALILLI_DOMAIN = "piccalil.li";

export function isPiccalilliLoginPage(url: string): boolean {
  try {
    return new URL(url).pathname === "/login";
  } catch {
    return false;
  }
}

async function findRestrictedLessonUrl(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const lessonLinks = Array.from(
      document.querySelectorAll<HTMLAnchorElement>("a.course-navigation__lesson[href]")
    );
    const restricted = lessonLinks.find(
      (link) => link.querySelector('[data-access="true"]') === null
    );
    return restricted?.href ?? null;
  });
}

async function pageHasCourseAccess(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const hasLoginForm = document.querySelector('form[action="/login"]') !== null;
    const hasAccessWarning = /access required/i.test(document.body.textContent ?? "");
    const hasLessonContent = document.querySelector(".master-grid.flow.prose") !== null;
    return hasLessonContent && !hasLoginForm && !hasAccessWarning;
  });
}

/**
 * Creates a stateful session verifier which discovers a paid lesson on the
 * public overview and uses it as the access probe during login/session checks.
 */
export function createPiccalilliSessionVerifier(
  courseUrl: string
): (page: Page) => Promise<boolean> {
  const overviewUrl = normalizePiccalilliCourseUrl(courseUrl);
  let restrictedLessonUrl: string | null = null;

  return async (page: Page): Promise<boolean> => {
    if (isPiccalilliLoginPage(page.url())) return false;

    if (!restrictedLessonUrl) {
      if (page.url() !== overviewUrl) {
        await page.goto(overviewUrl, { timeout: 30000 });
        await page.waitForLoadState("domcontentloaded");
      }
      await page.waitForSelector(".course-navigation__lesson", {
        state: "attached",
        timeout: 10000,
      });
      restrictedLessonUrl = await findRestrictedLessonUrl(page);
      if (!restrictedLessonUrl) return false;
    }

    if (page.url() !== restrictedLessonUrl) {
      await page.goto(restrictedLessonUrl, { timeout: 30000 });
      await page.waitForLoadState("domcontentloaded");
    }

    return pageHasCourseAccess(page);
  };
}
