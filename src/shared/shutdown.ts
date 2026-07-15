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

export interface ShutdownManagerOptions {
  /** Maximum time allowed for cleanup before the process exits. */
  cleanupTimeoutMs?: number;
  /** Ignore duplicate signals emitted by subprocess handlers in this window. */
  duplicateSignalWindowMs?: number;
}

const DEFAULT_CLEANUP_TIMEOUT_MS = 3000;
const DEFAULT_DUPLICATE_SIGNAL_WINDOW_MS = 250;

function getSignalExitCode(signal: string): number {
  return signal === "SIGINT" ? 130 : 143;
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
export function createShutdownManager(options: ShutdownManagerOptions = {}): ShutdownManager {
  let shuttingDown = false;
  let shutdownStartedAt = 0;
  let setupComplete = false;
  const resources: CleanupResources = {};
  const cleanupTimeoutMs = options.cleanupTimeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS;
  const duplicateSignalWindowMs =
    options.duplicateSignalWindowMs ?? DEFAULT_DUPLICATE_SIGNAL_WINDOW_MS;

  const shutdown = async (signal: string): Promise<void> => {
    const exitCode = getSignalExitCode(signal);

    if (shuttingDown) {
      if (Date.now() - shutdownStartedAt < duplicateSignalWindowMs) return;

      // Force exit on second signal
      console.log(chalk.red("\n\n⚠️  Force exit"));
      process.exit(exitCode);
      return;
    }

    shuttingDown = true;
    shutdownStartedAt = Date.now();
    process.exitCode = exitCode;
    console.log(chalk.yellow(`\n\n⏹️  ${signal} received, shutting down gracefully...`));

    // Closing the browser aborts in-flight Playwright operations, so start it
    // immediately alongside any state cleanup instead of waiting sequentially.
    const runCustomCleanup = async () => resources.onCleanup?.();
    const closeBrowser = async () => resources.browser?.close();
    const cleanup = Promise.allSettled([runCustomCleanup(), closeBrowser()]).then(() => undefined);

    let cleanupFinished = false;
    void cleanup.then(() => {
      cleanupFinished = true;
    });

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const cleanupDeadline = new Promise<void>((resolve) => {
      timeout = setTimeout(resolve, cleanupTimeoutMs);
    });

    await Promise.race([cleanup, cleanupDeadline]);
    if (timeout) clearTimeout(timeout);

    if (cleanupFinished) {
      console.log(chalk.gray("   Cleanup complete. State saved."));
    } else {
      console.log(chalk.gray("   Cleanup timed out; forcing process exit."));
    }

    process.exit(exitCode);
  };

  return {
    setup: () => {
      if (setupComplete) return;
      setupComplete = true;
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
