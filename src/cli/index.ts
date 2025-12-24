#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { configGetCommand, configSetCommand, configShowCommand } from "./commands/config.js";
import { inspectCommand } from "./commands/inspect.js";
import { loginCommand, logoutCommand } from "./commands/login.js";
import { statusCommand, statusListCommand, type StatusOptions } from "./commands/status.js";
import { syncCommand, type SyncOptions } from "./commands/sync.js";
import {
  syncHighLevelCommand,
  isHighLevelPortal,
  type SyncHighLevelOptions,
} from "./commands/syncHighLevel.js";
import {
  syncLearningSuiteCommand,
  completeLearningSuiteCommand,
  isLearningSuitePortal,
  type SyncLearningSuiteOptions,
} from "./commands/syncLearningSuite.js";

// Global error handler to ensure clean exit
process.on("unhandledRejection", (reason) => {
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
  .version("0.1.0");

// Login command
program
  .command("login")
  .description("Log in to a learning platform (opens browser)")
  .option("-f, --force", "Force re-login even if session exists")
  .action(loginCommand);

// Logout command
program.command("logout").description("Clear saved session").action(logoutCommand);

// Sync command - auto-detects platform
program
  .command("sync <url>")
  .description("Download a course for offline access (auto-detects platform)")
  .option("--skip-videos", "Skip video downloads (only save text content)")
  .option("--skip-content", "Skip text content (only download videos)")
  .option("--dry-run", "Scan course structure without downloading")
  .option("--limit <n>", "Limit to first N lessons (for testing)", parseInt)
  .option("-f, --force", "Force full rescan of all lessons")
  .option("--retry-failed", "Retry failed lessons with detailed diagnostics")
  .option("--visible", "Show browser window (default: headless)")
  .option("-q, --quality <quality>", "Preferred video quality (e.g., 720p, 1080p)")
  .option("--course-name <name>", "Override detected course name")
  .action(
    wrapAction(
      async (
        url: string,
        options: SyncOptions & SyncHighLevelOptions & SyncLearningSuiteOptions
      ) => {
        // Auto-detect platform
        if (url.includes("skool.com")) {
          await syncCommand(url, options);
        } else if (isLearningSuitePortal(url)) {
          await syncLearningSuiteCommand(url, options);
        } else if (isHighLevelPortal(url)) {
          await syncHighLevelCommand(url, options);
        } else {
          // Default: try HighLevel (most generic)
          console.log("Platform not recognized, trying as HighLevel portal...");
          await syncHighLevelCommand(url, options);
        }
      }
    )
  );

// Explicit Skool sync command
program
  .command("sync-skool <url>")
  .description("Download a Skool course for offline access")
  .option("--skip-videos", "Skip video downloads (only save text content)")
  .option("--skip-content", "Skip text content (only download videos)")
  .option("--dry-run", "Scan course structure without downloading")
  .option("--limit <n>", "Limit to first N lessons (for testing)", parseInt)
  .option("-f, --force", "Force full rescan of all lessons")
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
