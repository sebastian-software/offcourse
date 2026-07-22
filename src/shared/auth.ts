import type { Browser, BrowserContext, BrowserContextOptions, Page } from "playwright";
import { chromium } from "playwright";
import { getSessionPath, SESSIONS_DIR } from "../config/paths.js";
import { ensureDir, outputJson, pathExists, readJson, removeFile } from "./fs.js";

const SESSION_DIRECTORY_MODE = 0o700;
const SESSION_FILE_MODE = 0o600;
type StorageState = Exclude<NonNullable<BrowserContextOptions["storageState"]>, string>;

export interface AuthSession {
  context: BrowserContext;
  page: Page;
}

export interface AuthSessionOptions {
  forceLogin?: boolean;
  headless?: boolean;
  useStandardBrowserUserAgent?: boolean;
}

export interface AuthVerificationOptions {
  /** Whether a verifier may navigate away from the page being inspected. */
  allowNavigation?: boolean;
}

export interface AuthConfig {
  /** Domain to store session under */
  domain: string;
  /** URL to navigate to for login */
  loginUrl: string;
  /** Function to check if current URL is a login page */
  isLoginPage: (url: string) => boolean;
  /** Optional: Function to verify session is valid after navigation */
  verifySession?: (page: Page, options?: AuthVerificationOptions) => Promise<boolean>;
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

/**
 * Returns whether an auth check failed only because the page was navigating.
 * These errors are expected while a user submits multi-step login forms.
 */
export function isTransientAuthNavigationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return [
    "Execution context was destroyed",
    "Cannot find context with specified id",
    "Frame was detached",
    "frame got detached",
    "Inspected target navigated or closed",
  ].some((fragment) => message.includes(fragment));
}

// ============================================
// Browser automation
// ============================================

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
async function loadSession(
  browser: Browser,
  domain: string,
  useStandardBrowserUserAgent = false
): Promise<BrowserContext> {
  const sessionPath = getSessionPath(domain);
  const storageState = await readJson<StorageState>(sessionPath);
  if (!storageState) {
    throw new Error("Session file not found or invalid");
  }
  const userAgent = useStandardBrowserUserAgent
    ? await getStandardBrowserUserAgent(browser)
    : undefined;
  return browser.newContext({
    storageState,
    ...(userAgent ? { userAgent } : {}),
  });
}

export function normalizeHeadlessChromiumUserAgent(userAgent: string): string {
  return userAgent.replace(/\bHeadlessChrome\//g, "Chrome/");
}

async function getStandardBrowserUserAgent(browser: Browser): Promise<string | undefined> {
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext();
    const page = await context.newPage();
    return normalizeHeadlessChromiumUserAgent(await page.evaluate(() => navigator.userAgent));
  } catch {
    return undefined;
  } finally {
    await context?.close().catch(() => {});
  }
}

/**
 * Saves the current session to disk.
 */
async function saveSession(context: BrowserContext, domain: string): Promise<void> {
  const sessionPath = getSessionPath(domain);
  const storageState = await context.storageState();
  await outputJson(sessionPath, storageState, {
    mode: SESSION_FILE_MODE,
    directoryMode: SESSION_DIRECTORY_MODE,
  });
}

/**
 * Performs interactive login by opening a browser window.
 * The user logs in manually, and we capture the session.
 */
export async function performInteractiveLogin(config: AuthConfig): Promise<AuthSession> {
  await ensureDir(SESSIONS_DIR, { mode: SESSION_DIRECTORY_MODE });

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
        try {
          loggedIn = await config.verifySession(page, { allowNavigation: false });
        } catch (error) {
          if (!isTransientAuthNavigationError(error)) {
            await browser.close();
            throw error;
          }

          // The user submitted a form while the verifier was inspecting the
          // page. Wait for the next polling cycle and try again.
          loggedIn = false;
        }
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
  options: AuthSessionOptions = {}
): Promise<{ browser: Browser; session: AuthSession; usedCachedSession: boolean }> {
  const useHeadless = options.headless !== false;
  const useStandardBrowserUserAgent = useHeadless && options.useStandardBrowserUserAgent === true;

  const browser = await chromium.launch({
    headless: useHeadless,
  });

  // Try to use existing session
  if (!options.forceLogin && (await hasValidSession(config.domain))) {
    try {
      const context = await loadSession(browser, config.domain, useStandardBrowserUserAgent);
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
    const context = await loadSession(newBrowser, config.domain, useStandardBrowserUserAgent);
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
