/**
 * Graceful shutdown management for CLI commands.
 * Provides consistent signal handling and resource cleanup across all sync commands.
 */
import type { Browser } from "playwright";
import chalk from "chalk";

/**
 * Resources that can be registered for cleanup on shutdown.
 */
export interface CleanupResources {
  browser?: Browser;
  /** Generic cleanup function for additional resources (e.g., database) */
  onCleanup?: () => void | Promise<void>;
}

/**
 * Shutdown manager instance returned by createShutdownManager.
 */
export interface ShutdownManager {
  /** Set up SIGINT and SIGTERM handlers. Call once at command start. */
  setup: () => void;
  /** Returns false if shutdown has been requested. Use in loops. */
  shouldContinue: () => boolean;
  /** Register a browser for cleanup on shutdown. */
  registerBrowser: (browser: Browser) => void;
  /** Register a cleanup callback for additional resources. */
  registerCleanup: (fn: () => void | Promise<void>) => void;
  /** Check if shutdown is in progress. */
  isShuttingDown: () => boolean;
}

/**
 * Creates a shutdown manager for graceful CLI termination.
 *
 * @example
 * ```typescript
 * const shutdown = createShutdownManager();
 * shutdown.setup();
 * shutdown.registerBrowser(browser);
 * shutdown.registerCleanup(() => db.close());
 *
 * while (shutdown.shouldContinue() && hasMoreWork) {
 *   // Process work...
 * }
 * ```
 */
export function createShutdownManager(): ShutdownManager {
  let shuttingDown = false;
  const resources: CleanupResources = {};

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      // Force exit on second signal
      console.log(chalk.red("\n\n⚠️  Force exit"));
      process.exit(1);
    }

    shuttingDown = true;
    console.log(chalk.yellow(`\n\n⏹️  ${signal} received, shutting down gracefully...`));

    try {
      // Run custom cleanup first
      if (resources.onCleanup) {
        await resources.onCleanup();
      }
      // Close browser last
      if (resources.browser) {
        await resources.browser.close();
      }
      console.log(chalk.gray("   Cleanup complete. State saved."));
    } catch {
      // Ignore cleanup errors during shutdown
    }

    process.exit(0);
  };

  return {
    setup: () => {
      process.on("SIGINT", () => void shutdown("SIGINT"));
      process.on("SIGTERM", () => void shutdown("SIGTERM"));
    },

    shouldContinue: () => !shuttingDown,

    isShuttingDown: () => shuttingDown,

    registerBrowser: (browser: Browser) => {
      resources.browser = browser;
    },

    registerCleanup: (fn: () => void | Promise<void>) => {
      const previousCleanup = resources.onCleanup;
      resources.onCleanup = async () => {
        if (previousCleanup) {
          await previousCleanup();
        }
        await fn();
      };
    },
  };
}
