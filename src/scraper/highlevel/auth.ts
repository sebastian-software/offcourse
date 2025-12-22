import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";
import { getSessionPath, SESSIONS_DIR } from "../../config/paths.js";

export interface HighLevelAuthSession {
  context: BrowserContext;
  page: Page;
}

/**
 * Checks if a valid HighLevel session exists for the given domain.
 */
export function hasValidHighLevelSession(domain: string): boolean {
  const sessionPath = getSessionPath(domain);
  return existsSync(sessionPath);
}

/**
 * Loads an existing session from disk.
 */
async function loadSession(browser: Browser, domain: string): Promise<BrowserContext> {
  const sessionPath = getSessionPath(domain);
  const storageState = JSON.parse(readFileSync(sessionPath, "utf-8"));
  return browser.newContext({ storageState });
}

/**
 * Saves the current session to disk.
 */
async function saveSession(context: BrowserContext, domain: string): Promise<void> {
  const sessionPath = getSessionPath(domain);
  const dir = dirname(sessionPath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const storageState = await context.storageState();
  writeFileSync(sessionPath, JSON.stringify(storageState, null, 2), "utf-8");
}

/**
 * Checks if the current page is on a HighLevel login page.
 */
function isHighLevelLoginPage(url: string): boolean {
  const loginPatterns = [
    /sso\.clientclub\.net/,
    /\/login/,
    /\/signin/,
    /\/auth/,
    /accounts\.google\.com/,
    /firebaseapp\.com/,
  ];
  return loginPatterns.some((p) => p.test(url));
}

/**
 * Checks if the page has a valid Firebase auth token.
 */
async function hasValidFirebaseToken(page: Page): Promise<boolean> {
  try {
    const hasToken = await page.evaluate(() => {
      const tokenKey = Object.keys(localStorage).find((k) => k.includes("firebase:authUser"));
      if (!tokenKey) return false;

      const tokenData = JSON.parse(localStorage.getItem(tokenKey) ?? "{}");
      const expirationTime = tokenData?.stsTokenManager?.expirationTime;

      // Check if token exists and is not expired
      if (expirationTime) {
        return Date.now() < expirationTime;
      }

      return !!tokenData?.stsTokenManager?.accessToken;
    });
    return hasToken;
  } catch {
    return false;
  }
}

/**
 * Performs interactive login for HighLevel by opening a browser window.
 * The user logs in manually, and we capture the session.
 */
export async function performHighLevelInteractiveLogin(
  domain: string,
  portalUrl: string
): Promise<HighLevelAuthSession> {
  // Ensure sessions directory exists
  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true });
  }

  const browser = await chromium.launch({
    headless: false, // Must be visible for user interaction
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();
  await page.goto(portalUrl);

  console.log("\n🔐 Browser opened. Please log in manually.");
  console.log("   The window will close automatically after successful login.\n");

  // Wait for either:
  // 1. Navigation away from login page
  // 2. Firebase token to appear in localStorage
  let loggedIn = false;
  const startTime = Date.now();
  const timeout = 300000; // 5 minutes

  while (!loggedIn && Date.now() - startTime < timeout) {
    await page.waitForTimeout(1000);

    const currentUrl = page.url();

    // Check if we're still on a login page
    if (!isHighLevelLoginPage(currentUrl)) {
      // Might be logged in, check for Firebase token
      const hasToken = await hasValidFirebaseToken(page);
      if (hasToken) {
        loggedIn = true;
        break;
      }

      // Also check if we're on a course page (successful login)
      if (currentUrl.includes("/courses/") || currentUrl.includes("/library")) {
        loggedIn = true;
        break;
      }
    }
  }

  if (!loggedIn) {
    await browser.close();
    throw new Error("Login timed out after 5 minutes");
  }

  // Give the page a moment to fully load after login
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2000);

  // Save the session
  await saveSession(context, domain);

  console.log("✅ Login successful! Session saved.\n");

  return { context, page };
}

/**
 * Gets an authenticated HighLevel session, either from cache or via interactive login.
 */
export async function getHighLevelAuthenticatedSession(
  domain: string,
  portalUrl: string,
  options: { forceLogin?: boolean; headless?: boolean } = {}
): Promise<{ browser: Browser; session: HighLevelAuthSession }> {
  // Default to headless mode (true) unless explicitly set to false
  const useHeadless = options.headless !== false;

  const browser = await chromium.launch({
    headless: useHeadless,
  });

  // Try to use existing session
  if (!options.forceLogin && hasValidHighLevelSession(domain)) {
    try {
      const context = await loadSession(browser, domain);
      const page = await context.newPage();

      // Navigate to portal
      await page.goto(portalUrl);
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(2000);

      const currentUrl = page.url();

      // Check if we got redirected to login or SSO
      if (isHighLevelLoginPage(currentUrl)) {
        console.log("⚠️  Session expired, need to re-login...");
        await context.close();
        await browser.close();
      } else {
        // Verify we have a valid Firebase token
        const hasToken = await hasValidFirebaseToken(page);
        if (hasToken) {
          console.log("✅ Using cached session");
          return { browser, session: { context, page } };
        } else {
          console.log("⚠️  No valid auth token, need to re-login...");
          await context.close();
          await browser.close();
        }
      }
    } catch (error) {
      console.log("⚠️  Failed to load session, need to re-login...", error);
      await browser.close();
    }
  } else {
    await browser.close();
  }

  // Need fresh login - always visible for interactive login
  const session = await performHighLevelInteractiveLogin(domain, portalUrl);

  // Get the browser from the session context
  const sessionBrowser = session.context.browser();
  if (!sessionBrowser) {
    throw new Error("Failed to get browser from session");
  }

  // After login, reopen with headless browser (unless explicitly set to false)
  if (useHeadless) {
    const newBrowser = await chromium.launch({ headless: true });
    const context = await loadSession(newBrowser, domain);
    const page = await context.newPage();

    // Close the interactive session
    await sessionBrowser.close();

    return { browser: newBrowser, session: { context, page } };
  }

  return { browser: sessionBrowser, session };
}
