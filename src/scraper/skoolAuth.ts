import type { Page } from "playwright";
import { isSkoolLoginPage } from "../shared/auth.js";

export const SKOOL_DOMAIN = "www.skool.com";
export const SKOOL_LOGIN_URL = "https://www.skool.com/login";

const SKOOL_HOSTS = new Set(["skool.com", "www.skool.com"]);
const SKOOL_GLOBAL_PATHS = new Set([
  "calendar",
  "discovery",
  "login",
  "notifications",
  "profile",
  "settings",
]);

function parseSkoolUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    if (!SKOOL_HOSTS.has(parsed.hostname.toLowerCase())) return null;
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function isSkoolUrl(url: string): boolean {
  return parseSkoolUrl(url) !== null;
}

/**
 * Resolves any URL inside a Skool community to its classroom overview.
 * Global Skool URLs, such as the homepage or login, have no community target.
 */
export function normalizeSkoolClassroomUrl(url: string): string | null {
  const parsed = parseSkoolUrl(url);
  if (!parsed) return null;

  const communitySlug = parsed.pathname.split("/").find(Boolean);
  if (!communitySlug || SKOOL_GLOBAL_PATHS.has(communitySlug.toLowerCase())) return null;

  return `https://www.skool.com/${communitySlug}/classroom`;
}

function isExpectedClassroomUrl(url: string, expectedClassroomUrl: string): boolean {
  const current = parseSkoolUrl(url);
  const expected = new URL(expectedClassroomUrl);
  if (!current) return false;

  const expectedPath = expected.pathname.replace(/\/+$/, "");
  const currentPath = current.pathname.replace(/\/+$/, "");
  return currentPath === expectedPath || currentPath.startsWith(`${expectedPath}/`);
}

function isSkoolClassroomUrl(url: string): boolean {
  const current = parseSkoolUrl(url);
  return current ? /^\/[^/]+\/classroom(?:\/|$)/.test(current.pathname) : false;
}

/**
 * Verifies that the authenticated account can remain on the requested
 * community classroom instead of being redirected to login or a public page.
 */
export function createSkoolSessionVerifier(courseUrl: string): (page: Page) => Promise<boolean> {
  const classroomUrl = normalizeSkoolClassroomUrl(courseUrl);
  if (!classroomUrl) {
    throw new Error("A Skool community URL is required for access verification");
  }

  return async (page: Page): Promise<boolean> => {
    if (isSkoolLoginPage(page.url())) return false;

    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0 || !isExpectedClassroomUrl(page.url(), classroomUrl)) {
        await page.goto(classroomUrl, { timeout: 30000 });
        await page.waitForLoadState("domcontentloaded");
      }

      if (isSkoolLoginPage(page.url())) return false;

      const title = await page.title();
      if (isSkoolClassroomUrl(page.url()) && !/^404 Error$/i.test(title.trim())) {
        return true;
      }
    }

    return false;
  };
}
