import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Browser, BrowserContext, chromium, Page } from "playwright";
import { getSessionPath, SESSIONS_DIR } from "../config/paths.js";

export interface AuthSession {
  context: BrowserContext;
  page: Page;
}

/**
 * Checks if a valid session exists for the given domain.
 */
export function hasValidSession(domain: string): boolean {
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
 * Performs interactive login by opening a browser window.
 * The user logs in manually, and we capture the session.
 */
export async function performInteractiveLogin(
  domain: string,
  loginUrl: string
): Promise<AuthSession> {
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
  await page.goto(loginUrl);

  console.log("\n🔐 Browser opened. Please log in manually.");
  console.log("   The window will close automatically after successful login.\n");

  // Wait for navigation away from login page (indicates successful login)
  await page.waitForURL((url) => !url.pathname.includes("/login"), {
    timeout: 300000, // 5 minutes to complete login
  });

  // Give the page a moment to fully load after login
  await page.waitForLoadState("networkidle");

  // Save the session
  await saveSession(context, domain);

  console.log("✅ Login successful! Session saved.\n");

  return { context, page };
}

export interface SessionOptions {
  forceLogin?: boolean;
  headless?: boolean;
  fastMode?: boolean;  // Block images, fonts, stylesheets for faster loading
}

/**
 * Sets up fast mode by blocking unnecessary resources.
 */
async function setupFastMode(page: Page): Promise<void> {
  await page.route("**/*", (route) => {
    const resourceType = route.request().resourceType();
    // Block images, fonts, stylesheets - but NOT media (video URLs)
    if (["image", "font", "stylesheet"].includes(resourceType)) {
      return route.abort();
    }
    return route.continue();
  });
}

/**
 * Gets an authenticated session, either from cache or via interactive login.
 */
export async function getAuthenticatedSession(
  domain: string,
  loginUrl: string,
  options: SessionOptions = {}
): Promise<{ browser: Browser; session: AuthSession }> {
  const browser = await chromium.launch({
    headless: options.headless ?? false,
  });

  // Try to use existing session
  if (!options.forceLogin && hasValidSession(domain)) {
    try {
      const context = await loadSession(browser, domain);
      const page = await context.newPage();

      // Setup fast mode if requested
      if (options.fastMode) {
        await setupFastMode(page);
      }

      // Verify session is still valid by navigating
      await page.goto(`https://${domain}`);

      // Check if we got redirected to login
      const currentUrl = page.url();
      if (currentUrl.includes("/login")) {
        console.log("⚠️  Session expired, need to re-login...");
        await context.close();
      } else {
        console.log("✅ Using cached session");
        return { browser, session: { context, page } };
      }
    } catch (error) {
      console.log("⚠️  Failed to load session, need to re-login...", error);
    }
  }

  // Need fresh login
  await browser.close();
  const session = await performInteractiveLogin(domain, loginUrl);

  // Reopen browser with saved session for headless operation if needed
  const newBrowser = await chromium.launch({
    headless: options.headless ?? false,
  });
  const context = await loadSession(newBrowser, domain);
  const page = await context.newPage();

  // Setup fast mode if requested
  if (options.fastMode) {
    await setupFastMode(page);
  }

  // Close the interactive session
  await session.context.browser()?.close();

  return { browser: newBrowser, session: { context, page } };
}

/**
 * Clears the session for a domain.
 */
export function clearSession(domain: string): boolean {
  const sessionPath = getSessionPath(domain);
  if (existsSync(sessionPath)) {
    unlinkSync(sessionPath);
    return true;
  }
  return false;
}

