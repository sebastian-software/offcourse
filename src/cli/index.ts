#!/usr/bin/env node

import { Command } from "commander";
import { configGetCommand, configSetCommand, configShowCommand } from "./commands/config.js";
import { inspectCommand } from "./commands/inspect.js";
import { loginCommand, logoutCommand } from "./commands/login.js";
import { syncCommand } from "./commands/sync.js";

const program = new Command();

program
  .name("course-grab")
  .description("CLI tool to download online courses for offline access")
  .version("0.1.0");

// Login command
program
  .command("login")
  .description("Log in to Skool.com (opens browser)")
  .option("-f, --force", "Force re-login even if session exists")
  .action(loginCommand);

// Logout command
program.command("logout").description("Clear saved session").action(logoutCommand);

// Sync command
program
  .command("sync <url>")
  .description("Download a course from Skool.com")
  .option("--skip-videos", "Skip video downloads (only save text content)")
  .option("--skip-content", "Skip text content (only download videos)")
  .option("--dry-run", "Show what would be downloaded without actually downloading")
  .option("--limit <n>", "Limit to first N lessons (for testing)", parseInt)
  .action(syncCommand);

// Inspect command (debugging)
program
  .command("inspect <url>")
  .description("Analyze page structure for debugging")
  .option("-o, --output <dir>", "Save analysis to directory")
  .option("--full", "Save complete HTML as well")
  .option("--click", "Try to click video preview to trigger lazy loading")
  .option("--api", "Monitor API calls (find progress tracking endpoints)")
  .action(inspectCommand);

// Config commands
const configCmd = program.command("config").description("Manage configuration");

configCmd
  .command("show")
  .description("Show all configuration values")
  .action(configShowCommand);

configCmd
  .command("get <key>")
  .description("Get a configuration value")
  .action(configGetCommand);

configCmd
  .command("set <key> <value>")
  .description("Set a configuration value")
  .action(configSetCommand);

// Parse and run
program.parse();

