#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import packageJson from "../../package.json" with { type: "json" };
import { configGetCommand, configSetCommand, configShowCommand } from "./commands/config.js";
import { inspectCommand } from "./commands/inspect.js";
import { loginCommand, logoutCommand } from "./commands/login.js";
import { statusCommand, statusListCommand, type StatusOptions } from "./commands/status.js";
import { syncCommand, type SyncOptions } from "./commands/sync.js";
import { syncHighLevelCommand, type SyncHighLevelOptions } from "./commands/syncHighLevel.js";
import {
  syncLearningSuiteCommand,
  completeLearningSuiteCommand,
  type SyncLearningSuiteOptions,
} from "./commands/syncLearningSuite.js";
import { isLearningSuitePortal } from "../scraper/learningsuite/index.js";
import { syncPiccalilliCommand, type SyncPiccalilliOptions } from "./commands/syncPiccalilli.js";
import { detectSyncPlatform } from "./syncPlatform.js";

function isSignalShutdownPending(): boolean {
  return process.exitCode === 130 || process.exitCode === 143;
}

// Global error handler to ensure clean exit
process.on("unhandledRejection", (reason) => {
  if (isSignalShutdownPending()) return;

  console.error(chalk.red("\n❌ Unhandled error"));
  if (reason instanceof Error) {
    console.error(chalk.gray(`   ${reason.message}`));
  }
  process.exit(1);
});

// Helper to wrap async actions and handle errors
function wrapAction<T extends unknown[]>(fn: (...args: T) => Promise<void>): (...args: T) => void {
  return (...args: T) => {
    fn(...args).catch((error: unknown) => {
      if (isSignalShutdownPending()) return;

      // Error already logged by command, just exit
      if (error instanceof Error && error.message.includes("already logged")) {
        process.exit(1);
      }
      // Unlogged error
      console.error(chalk.red("\n❌ Command failed"));
      if (error instanceof Error) {
        console.error(chalk.gray(`   ${error.message}`));
      }
      process.exit(1);
    });
  };
}

const program = new Command();

program
  .name("offcourse")
  .description("Download online courses for offline access – of course!")
  .version(packageJson.version);

// Login command
program
  .command("login [url]")
  .description("Log in to a learning platform (opens browser)")
  .option("-f, --force", "Force re-login even if session exists")
  .action((url: string | undefined, options: { force?: boolean }) => loginCommand(url, options));

// Logout command
program
  .command("logout [url]")
  .description("Clear saved session")
  .action((url: string | undefined) => logoutCommand(url));

// Sync command - auto-detects platform
program
  .command("sync <url>")
  .description("Download a course for offline access (auto-detects platform)")
  .option("--skip-videos", "Skip video downloads (only save text content)")
  .option("--skip-content", "Skip text content (only download videos)")
  .option("--dry-run", "Scan course structure without downloading")
  .option("--limit <n>", "Limit to first N lessons (for testing)", parseInt)
  .option("--visible", "Show browser window (default: headless)")
  .action(
    wrapAction(
      async (
        url: string,
        options: SyncOptions &
          SyncHighLevelOptions &
          SyncLearningSuiteOptions &
          SyncPiccalilliOptions
      ) => {
        switch (detectSyncPlatform(url)) {
          case "skool":
            await syncCommand(url, options);
            break;
          case "learningsuite":
            await syncLearningSuiteCommand(url, options);
            break;
          case "piccalilli":
            await syncPiccalilliCommand(url, options);
            break;
          case "highlevel":
            await syncHighLevelCommand(url, options);
            break;
          default:
            throw new Error(
              "Unsupported course URL. Use sync-skool, sync-learningsuite, sync-piccalilli, or sync-highlevel for an explicit platform."
            );
        }
      }
    )
  );

// Explicit Piccalilli sync command
program
  .command("sync-piccalilli <url>")
  .description("Download a Piccalilli course for offline access")
  .option("--skip-videos", "Skip video downloads (only save text content)")
  .option("--skip-content", "Skip text content and resources (only download videos)")
  .option("--dry-run", "Scan course structure without downloading or logging in")
  .option("--limit <n>", "Limit to first N lessons (for testing)", parseInt)
  .option("-f, --force", "Re-extract cached lesson content and resources")
  .option("--visible", "Show browser window (default: headless)")
  .option("-q, --quality <quality>", "Preferred video quality (e.g., 720p, 1080p)")
  .option("--course-name <name>", "Override detected course name")
  .action(wrapAction(syncPiccalilliCommand));

// Explicit Skool sync command
program
  .command("sync-skool <url>")
  .description("Download a Skool course for offline access")
  .option("--skip-videos", "Skip video downloads (only save text content)")
  .option("--skip-content", "Skip text content (only download videos)")
  .option("--dry-run", "Scan course structure without downloading")
  .option("--limit <n>", "Limit to first N lessons (for testing)", parseInt)
  .option("-f, --force", "Reset saved scan state and rescan all lessons")
  .option("--retry-failed", "Retry failed lessons with detailed diagnostics")
  .option("--visible", "Show browser window (default: headless)")
  .action(wrapAction(syncCommand));

// Explicit HighLevel sync command
program
  .command("sync-highlevel <url>")
  .description("Download a HighLevel (GoHighLevel) course for offline access")
  .option("--skip-videos", "Skip video downloads (only save text content)")
  .option("--skip-content", "Skip text content (only download videos)")
  .option("--dry-run", "Scan course structure without downloading")
  .option("--limit <n>", "Limit to first N lessons (for testing)", parseInt)
  .option("--visible", "Show browser window (default: headless)")
  .option("-q, --quality <quality>", "Preferred video quality (e.g., 720p, 1080p)")
  .option("--course-name <name>", "Override detected course name")
  .action(wrapAction(syncHighLevelCommand));

// Explicit LearningSuite sync command
program
  .command("sync-learningsuite <url>")
  .description("Download a LearningSuite course for offline access")
  .option("--skip-videos", "Skip video downloads (only save text content)")
  .option("--skip-content", "Skip text content (only download videos)")
  .option("--dry-run", "Scan course structure without downloading")
  .option("--limit <n>", "Limit to first N lessons (for testing)", parseInt)
  .option("--visible", "Show browser window (default: headless)")
  .option("-q, --quality <quality>", "Preferred video quality (e.g., 720p, 1080p)")
  .option("--course-name <name>", "Override detected course name")
  .action(wrapAction(syncLearningSuiteCommand));

// Complete command - mark lessons as complete to unlock content
program
  .command("complete <url>")
  .description("Mark lessons as complete to unlock sequential content")
  .option("--visible", "Show browser window (default: headless)")
  .action(
    wrapAction(async (url: string, options: { visible?: boolean }) => {
      if (isLearningSuitePortal(url)) {
        await completeLearningSuiteCommand(url, options);
      } else if (url.includes("skool.com")) {
        console.log("\n⚠️  Auto-complete for Skool coming soon!\n");
        console.log("   Skool lessons can be marked complete manually in the browser.");
        console.log("   This feature will be added in a future update.\n");
        process.exit(0);
      } else {
        console.log("\n❌ Platform not supported for auto-complete.\n");
        console.log("   Currently supported: LearningSuite");
        console.log("   Coming soon: Skool\n");
        process.exit(1);
      }
    })
  );

// Status command
program
  .command("status [url]")
  .description("Show sync status for a course (or list all if no URL)")
  .option("--errors", "Show details for failed downloads")
  .option("--pending", "Show not-yet-scanned lessons")
  .option("-a, --all", "Show all details")
  .action((url: string | undefined, options: StatusOptions) => {
    if (url) {
      statusCommand(url, options);
    } else {
      void statusListCommand();
    }
  });

// Inspect command (debugging)
program
  .command("inspect <url>")
  .description("Analyze page structure for debugging")
  .option("-o, --output <dir>", "Save analysis to directory")
  .option("--full", "Save complete HTML as well")
  .option("--click", "Try to click video preview to trigger lazy loading")
  .action(inspectCommand);

// Config commands
const configCmd = program.command("config").description("Manage configuration");

configCmd.command("show").description("Show all configuration values").action(configShowCommand);

configCmd.command("get <key>").description("Get a configuration value").action(configGetCommand);

configCmd
  .command("set <key> <value>")
  .description("Set a configuration value")
  .action(configSetCommand);

// Parse and run
program.parse();
