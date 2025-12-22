#!/usr/bin/env node

import { Command } from "commander";
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
  isLearningSuitePortal,
  type SyncLearningSuiteOptions,
} from "./commands/syncLearningSuite.js";

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
  .option("--auto-complete", "Auto-complete lessons to unlock sequential content (LearningSuite)")
  .action((url: string, options: SyncOptions & SyncHighLevelOptions & SyncLearningSuiteOptions) => {
    // Auto-detect platform
    if (url.includes("skool.com")) {
      return syncCommand(url, options);
    } else if (isLearningSuitePortal(url)) {
      return syncLearningSuiteCommand(url, options);
    } else if (isHighLevelPortal(url)) {
      return syncHighLevelCommand(url, options);
    } else {
      // Default: try HighLevel (most generic)
      console.log("Platform not recognized, trying as HighLevel portal...");
      return syncHighLevelCommand(url, options);
    }
  });

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
  .action(syncCommand);

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
  .action(syncHighLevelCommand);

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
  .option("--auto-complete", "Auto-complete lessons to unlock sequential content")
  .action(syncLearningSuiteCommand);

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
