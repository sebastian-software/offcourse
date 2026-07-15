import chalk from "chalk";
import {
  clearSession,
  getAuthenticatedSession,
  hasValidSession,
  isSkoolLoginPage,
} from "../../shared/auth.js";
import {
  createPiccalilliSessionVerifier,
  isPiccalilliCourseUrl,
  isPiccalilliLoginPage,
  normalizePiccalilliCourseUrl,
  PICCALILLI_DOMAIN,
  PICCALILLI_LOGIN_URL,
} from "../../scraper/piccalilli/index.js";

const SKOOL_DOMAIN = "www.skool.com";
const SKOOL_LOGIN_URL = "https://www.skool.com/login";

/**
 * Handles the login command.
 * Opens a browser for the user to log in manually.
 */
export async function loginCommand(
  url: string | undefined,
  options: { force?: boolean }
): Promise<void> {
  const isPiccalilli = typeof url === "string" && isPiccalilliCourseUrl(url);
  const domain = isPiccalilli ? PICCALILLI_DOMAIN : SKOOL_DOMAIN;
  const courseUrl = isPiccalilli ? normalizePiccalilliCourseUrl(url) : undefined;
  const loginUrl = isPiccalilli ? PICCALILLI_LOGIN_URL : SKOOL_LOGIN_URL;
  const isLoginPage = isPiccalilli ? isPiccalilliLoginPage : isSkoolLoginPage;
  const verifySession = courseUrl ? createPiccalilliSessionVerifier(courseUrl) : undefined;

  if (url && !isPiccalilli) {
    throw new Error("Explicit login URLs are currently supported for Piccalilli courses only");
  }

  console.log(chalk.blue(`\n🔐 ${isPiccalilli ? "Piccalilli" : "Skool.com"} Login\n`));

  if ((await hasValidSession(domain)) && !options.force) {
    console.log(chalk.yellow("⚠️  You already have an active session."));
    console.log(chalk.gray("   Use --force to re-login anyway.\n"));
    return;
  }

  if (options.force) {
    await clearSession(domain);
    console.log(chalk.gray("   Cleared existing session.\n"));
  }

  try {
    const { browser } = await getAuthenticatedSession(
      {
        domain,
        loginUrl,
        isLoginPage,
        ...(verifySession ? { verifySession } : {}),
      },
      { headless: false }
    );

    // Close the browser after successful login
    await browser.close();

    console.log(chalk.green("✅ Login successful!"));
    console.log(chalk.gray("   Your session has been saved.\n"));
    console.log(chalk.gray("   You can now use: offcourse sync <url>\n"));
  } catch (error) {
    if (error instanceof Error && error.message.includes("Timeout")) {
      console.log(chalk.red("\n❌ Login timed out."));
      console.log(chalk.gray("   Please try again and complete the login within 5 minutes.\n"));
    } else {
      console.log(chalk.red("\n❌ Login failed:"), error);
    }
    process.exit(1);
  }
}

/**
 * Handles the logout command.
 */
export async function logoutCommand(url?: string): Promise<void> {
  const domain = url && isPiccalilliCourseUrl(url) ? PICCALILLI_DOMAIN : SKOOL_DOMAIN;
  console.log(chalk.blue("\n🔓 Logging out...\n"));

  if (await clearSession(domain)) {
    console.log(chalk.green("✅ Session cleared successfully.\n"));
  } else {
    console.log(chalk.yellow("⚠️  No active session found.\n"));
  }
}
