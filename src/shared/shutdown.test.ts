import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Browser } from "playwright";
import { createShutdownManager } from "./shutdown.js";

describe("shutdown", () => {
  // Store original methods using bind to avoid unbound-method issues
  const originalProcessOn = process.on.bind(process);
  const originalProcessExit = process.exit.bind(process);

  let registeredHandlers: Map<string, () => void>;
  let mockProcessOn: ReturnType<typeof vi.fn>;
  let mockProcessExit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    registeredHandlers = new Map();

    // Create mock functions
    mockProcessOn = vi.fn((event: string, handler: () => void) => {
      registeredHandlers.set(event, handler);
      return process;
    });
    mockProcessExit = vi.fn();

    // Replace process methods with mocks
    process.on = mockProcessOn as unknown as typeof process.on;
    process.exit = mockProcessExit as unknown as typeof process.exit;
  });

  afterEach(() => {
    // Restore originals
    process.on = originalProcessOn;
    process.exit = originalProcessExit;
  });

  describe("createShutdownManager", () => {
    it("creates a shutdown manager with required methods", () => {
      const manager = createShutdownManager();

      expect(manager).toHaveProperty("setup");
      expect(manager).toHaveProperty("shouldContinue");
      expect(manager).toHaveProperty("isShuttingDown");
      expect(manager).toHaveProperty("registerBrowser");
      expect(manager).toHaveProperty("registerCleanup");
    });
  });

  describe("setup", () => {
    it("registers SIGINT and SIGTERM handlers", () => {
      const manager = createShutdownManager();
      manager.setup();

      expect(mockProcessOn).toHaveBeenCalledWith("SIGINT", expect.any(Function));
      expect(mockProcessOn).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
    });
  });

  describe("shouldContinue", () => {
    it("returns true initially", () => {
      const manager = createShutdownManager();
      expect(manager.shouldContinue()).toBe(true);
    });

    it("returns false after shutdown is triggered", async () => {
      const manager = createShutdownManager();
      manager.setup();

      // Initially true
      expect(manager.shouldContinue()).toBe(true);

      // Trigger SIGINT handler
      const sigintHandler = registeredHandlers.get("SIGINT");
      expect(sigintHandler).toBeDefined();

      // Execute the handler (it's async internally)
      sigintHandler!();

      // Give the async handler time to set the flag
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should now be false
      expect(manager.shouldContinue()).toBe(false);
    });
  });

  describe("isShuttingDown", () => {
    it("returns false initially", () => {
      const manager = createShutdownManager();
      expect(manager.isShuttingDown()).toBe(false);
    });

    it("returns true after shutdown is triggered", async () => {
      const manager = createShutdownManager();
      manager.setup();

      const sigintHandler = registeredHandlers.get("SIGINT");
      sigintHandler!();

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(manager.isShuttingDown()).toBe(true);
    });
  });

  describe("registerBrowser", () => {
    it("registers a browser for cleanup", async () => {
      const manager = createShutdownManager();
      manager.setup();

      const closeFn = vi.fn().mockResolvedValue(undefined);
      const mockBrowser = { close: closeFn } as unknown as Browser;

      manager.registerBrowser(mockBrowser);

      // Trigger shutdown
      const sigintHandler = registeredHandlers.get("SIGINT");
      sigintHandler!();

      // Wait for async cleanup
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(closeFn).toHaveBeenCalled();
    });
  });

  describe("registerCleanup", () => {
    it("registers a cleanup function that is called on shutdown", async () => {
      const manager = createShutdownManager();
      manager.setup();

      const cleanup = vi.fn();
      manager.registerCleanup(cleanup);

      // Trigger shutdown
      const sigintHandler = registeredHandlers.get("SIGINT");
      sigintHandler!();

      // Wait for async cleanup
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(cleanup).toHaveBeenCalled();
    });

    it("chains multiple cleanup functions", async () => {
      const manager = createShutdownManager();
      manager.setup();

      const cleanup1 = vi.fn();
      const cleanup2 = vi.fn();

      manager.registerCleanup(cleanup1);
      manager.registerCleanup(cleanup2);

      // Trigger shutdown
      const sigintHandler = registeredHandlers.get("SIGINT");
      sigintHandler!();

      // Wait for async cleanup
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(cleanup1).toHaveBeenCalled();
      expect(cleanup2).toHaveBeenCalled();
    });

    it("handles async cleanup functions", async () => {
      const manager = createShutdownManager();
      manager.setup();

      const asyncCleanup = vi.fn().mockResolvedValue(undefined);
      manager.registerCleanup(asyncCleanup);

      // Trigger shutdown
      const sigintHandler = registeredHandlers.get("SIGINT");
      sigintHandler!();

      // Wait for async cleanup
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(asyncCleanup).toHaveBeenCalled();
    });
  });

  describe("cleanup order", () => {
    it("runs custom cleanup before closing browser", async () => {
      const manager = createShutdownManager();
      manager.setup();

      const order: string[] = [];

      const closeFn = vi.fn().mockImplementation(() => {
        order.push("browser");
        return Promise.resolve();
      });
      const mockBrowser = { close: closeFn } as unknown as Browser;

      manager.registerBrowser(mockBrowser);
      manager.registerCleanup(() => {
        order.push("custom");
      });

      // Trigger shutdown
      const sigintHandler = registeredHandlers.get("SIGINT");
      sigintHandler!();

      // Wait for async cleanup
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(order).toEqual(["custom", "browser"]);
    });
  });

  describe("error handling", () => {
    it("ignores errors during cleanup", async () => {
      const manager = createShutdownManager();
      manager.setup();

      const failingCleanup = vi.fn().mockRejectedValue(new Error("Cleanup failed"));
      manager.registerCleanup(failingCleanup);

      // Should not throw - call the handler
      const sigintHandler = registeredHandlers.get("SIGINT");
      const callHandler = () => {
        sigintHandler!();
      };
      expect(callHandler).not.toThrow();

      // Wait for async cleanup
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should still call exit
      expect(mockProcessExit).toHaveBeenCalledWith(0);
    });
  });

  describe("multiple managers", () => {
    it("creates independent instances", () => {
      const manager1 = createShutdownManager();
      const manager2 = createShutdownManager();

      expect(manager1).not.toBe(manager2);
      expect(manager1.shouldContinue()).toBe(true);
      expect(manager2.shouldContinue()).toBe(true);
    });
  });
});
