import type { Page } from "playwright";
import { createLoginChecker } from "../../shared/auth.js";

const LEARNINGSUITE_HOST_PATTERN = /^[^.]+\.learningsuite\.io$/i;

/** Recognizes login and external identity-provider pages used by LearningSuite. */
export const isLearningSuiteLoginPage = createLoginChecker([
  /\/auth(?:$|\/|\?)/,
  /\/login/,
  /\/signin/,
  /accounts\.google\.com/,
]);

/** Returns the tenant hostname used to scope the saved browser session. */
export function getLearningSuiteDomain(url: string): string | null {
  try {
    const { hostname, protocol } = new URL(url);
    if (
      (protocol !== "https:" && protocol !== "http:") ||
      !LEARNINGSUITE_HOST_PATTERN.test(hostname)
    ) {
      return null;
    }

    return hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Detects tenant-specific LearningSuite portal URLs without accepting lookalike hosts. */
export function isLearningSuitePortal(url: string): boolean {
  return getLearningSuiteDomain(url) !== null;
}

/**
 * Creates a session check scoped to the tenant from the requested course URL.
 * LearningSuite tenants store sessions independently, so a session from one
 * subdomain must never satisfy login for another one.
 */
export function createLearningSuiteSessionVerifier(
  courseUrl: string
): (page: Page) => Promise<boolean> {
  const expectedDomain = getLearningSuiteDomain(courseUrl);
  if (!expectedDomain) {
    throw new Error("Invalid LearningSuite course URL");
  }

  return async (page: Page): Promise<boolean> => {
    let currentUrl: URL;
    try {
      currentUrl = new URL(page.url());
    } catch {
      return false;
    }

    if (
      currentUrl.hostname.toLowerCase() !== expectedDomain ||
      isLearningSuiteLoginPage(currentUrl.href)
    ) {
      return false;
    }

    if (
      currentUrl.pathname.includes("/student") ||
      currentUrl.pathname.includes("/course") ||
      currentUrl.pathname.includes("/dashboard")
    ) {
      return true;
    }

    return page.evaluate(() => {
      const tokenKeys = ["accessToken", "token", "authToken", "jwt", "access_token", "id_token"];
      for (const key of tokenKeys) {
        if (localStorage.getItem(key) || sessionStorage.getItem(key)) return true;
      }

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const normalizedKey = key?.toLowerCase();
        if (
          key &&
          normalizedKey &&
          (normalizedKey.includes("auth") ||
            normalizedKey.includes("token") ||
            normalizedKey.includes("session"))
        ) {
          const value = localStorage.getItem(key);
          if (value && value.length > 10) return true;
        }
      }

      return ["user", "currentUser", "userInfo", "profile"].some((key) =>
        Boolean(localStorage.getItem(key))
      );
    });
  };
}
