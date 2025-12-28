import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";
import { getSessionPath, SESSIONS_DIR } from "../config/paths.js";
import { ensureDir, outputJson, pathExists, readJson, removeFile } from "./fs.js";

export interface AuthSession {
  context: BrowserContext;
  page: Page;
}

export interface AuthConfig {
  /** Domain to store session under */
  domain: string;
  /** URL to navigate to for login */
  loginUrl: string;
  /** Function to check if current URL is a login page */
  isLoginPage: (url: string) => boolean;
  /** Optional: Function to verify session is valid after navigation */
  verifySession?: (page: Page) => Promise<boolean>;
  /** Login timeout in ms (default: 5 minutes) */
  loginTimeout?: number;
}

/**
 * Default login page detection patterns.
 */
const DEFAULT_LOGIN_PATTERNS = [
  /\/login/,
  /\/signin/,
  /\/auth/,
  /accounts\.google\.com/,
  /firebaseapp\.com/,
  /sso\./,
];

/**
 * Creates a login page checker from patterns.
 */
export function createLoginChecker(
  patterns: RegExp[] = DEFAULT_LOGIN_PATTERNS
): (url: string) => boolean {
  return (url: string) => patterns.some((p) => p.test(url));
}

/**
 * Skool-specific login page checker.
 */
export const isSkoolLoginPage = createLoginChecker([/\/login/, /accounts\.google\.com/]);

/**
 * HighLevel-specific login page checker.
 */
export const isHighLevelLoginPage = createLoginChecker([
  /sso\.clientclub\.net/,
  /\/login/,
  /\/signin/,
  /\/auth/,
  /accounts\.google\.com/,
  /firebaseapp\.com/,
]);

// ============================================
// Browser automation - not unit testable
// ============================================
/* v8 ignore start */

/**
 * Checks if a valid session exists for the given domain.
 */
export async function hasValidSession(domain: string): Promise<boolean> {
  const sessionPath = getSessionPath(domain);
  return pathExists(sessionPath);
}

/**
 * Loads an existing session from disk.
 */
async function loadSession(browser: Browser, domain: string): Promise<BrowserContext> {
  const sessionPath = getSessionPath(domain);
  // Playwright's storageState type is complex, we load it as-is from JSON
  const storageState = await readJson(sessionPath);
  if (!storageState) {
    throw new Error("Session file not found or invalid");
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
  return browser.newContext({ storageState: storageState as any });
}

/**
 * Saves the current session to disk.
 */
async function saveSession(context: BrowserContext, domain: string): Promise<void> {
  const sessionPath = getSessionPath(domain);
  const storageState = await context.storageState();
  await outputJson(sessionPath, storageState);
}

/**
 * Performs interactive login by opening a browser window.
 * The user logs in manually, and we capture the session.
 */
export async function performInteractiveLogin(config: AuthConfig): Promise<AuthSession> {
  await ensureDir(SESSIONS_DIR);

  const browser = await chromium.launch({
    headless: false, // Must be visible for user interaction
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();
  await page.goto(config.loginUrl);

  console.log("\n🔐 Browser opened. Please log in manually.");
  console.log("   The window will close automatically after successful login.\n");

  const timeout = config.loginTimeout ?? 300000; // 5 minutes default
  const startTime = Date.now();
  let loggedIn = false;

  while (!loggedIn && Date.now() - startTime < timeout) {
    await page.waitForTimeout(1000);

    const currentUrl = page.url();

    // Check if we're no longer on a login page
    if (!config.isLoginPage(currentUrl)) {
      // Optionally verify with custom function
      if (config.verifySession) {
        loggedIn = await config.verifySession(page);
      } else {
        loggedIn = true;
      }
    }
  }

  if (!loggedIn) {
    await browser.close();
    throw new Error(`Login timed out after ${timeout / 1000} seconds`);
  }

  // Give the page a moment to fully load after login
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1000);

  // Save the session
  await saveSession(context, config.domain);

  console.log("✅ Login successful! Session saved.\n");

  return { context, page };
}

/**
 * Gets an authenticated session, either from cache or via interactive login.
 */
export async function getAuthenticatedSession(
  config: AuthConfig,
  options: { forceLogin?: boolean; headless?: boolean } = {}
): Promise<{ browser: Browser; session: AuthSession; usedCachedSession: boolean }> {
  const useHeadless = options.headless !== false;

  const browser = await chromium.launch({
    headless: useHeadless,
  });

  // Try to use existing session
  if (!options.forceLogin && (await hasValidSession(config.domain))) {
    try {
      const context = await loadSession(browser, config.domain);
      const page = await context.newPage();

      // Navigate to verify session
      await page.goto(config.loginUrl);
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(2000);

      const currentUrl = page.url();

      // Check if we got redirected to login
      if (config.isLoginPage(currentUrl)) {
        // Session expired
        await context.close();
        await browser.close();
      } else {
        // Optionally verify session
        if (config.verifySession) {
          const isValid = await config.verifySession(page);
          if (!isValid) {
            // Session invalid
            await context.close();
            await browser.close();
          } else {
            return { browser, session: { context, page }, usedCachedSession: true };
          }
        } else {
          return { browser, session: { context, page }, usedCachedSession: true };
        }
      }
    } catch {
      // Failed to load session
      await browser.close();
    }
  } else {
    await browser.close();
  }

  // Need fresh login - always visible for interactive login
  const session = await performInteractiveLogin(config);

  // Get the browser from the session context
  const sessionBrowser = session.context.browser();
  if (!sessionBrowser) {
    throw new Error("Failed to get browser from session");
  }

  // After login, reopen with headless browser if needed
  if (useHeadless) {
    const newBrowser = await chromium.launch({ headless: true });
    const context = await loadSession(newBrowser, config.domain);
    const page = await context.newPage();

    // Close the interactive session
    await sessionBrowser.close();

    return { browser: newBrowser, session: { context, page }, usedCachedSession: false };
  }

  return { browser: sessionBrowser, session, usedCachedSession: false };
}

/**
 * Clears the session for a domain.
 */
export async function clearSession(domain: string): Promise<boolean> {
  const sessionPath = getSessionPath(domain);
  return removeFile(sessionPath);
}

/**
 * Checks if the page has a valid Firebase auth token.
 * Used by HighLevel/GoHighLevel portals.
 */
// Re-export Firebase auth utilities (used by multiple platforms)
export { hasValidFirebaseToken } from "./firebase.js";

/* v8 ignore stop */
