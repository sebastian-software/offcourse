import chalk from "chalk";
import {
  clearSession,
  getAuthenticatedSession,
  hasValidSession,
  isSkoolLoginPage,
} from "../../shared/auth.js";

const SKOOL_DOMAIN = "www.skool.com";
const SKOOL_LOGIN_URL = "https://www.skool.com/login";

/**
 * Handles the login command.
 * Opens a browser for the user to log in manually.
 */
export async function loginCommand(options: { force?: boolean }): Promise<void> {
  console.log(chalk.blue("\n🔐 Skool.com Login\n"));

  if ((await hasValidSession(SKOOL_DOMAIN)) && !options.force) {
    console.log(chalk.yellow("⚠️  You already have an active session."));
    console.log(chalk.gray("   Use --force to re-login anyway.\n"));
    return;
  }

  if (options.force) {
    await clearSession(SKOOL_DOMAIN);
    console.log(chalk.gray("   Cleared existing session.\n"));
  }

  try {
    const { browser } = await getAuthenticatedSession(
      {
        domain: SKOOL_DOMAIN,
        loginUrl: SKOOL_LOGIN_URL,
        isLoginPage: isSkoolLoginPage,
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
export async function logoutCommand(): Promise<void> {
  console.log(chalk.blue("\n🔓 Logging out...\n"));

  if (await clearSession(SKOOL_DOMAIN)) {
    console.log(chalk.green("✅ Session cleared successfully.\n"));
  } else {
    console.log(chalk.yellow("⚠️  No active session found.\n"));
  }
}
