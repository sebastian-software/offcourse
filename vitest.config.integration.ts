import { defineConfig } from "vitest/config";

/**
 * Vitest configuration for integration tests.
 *
 * These tests require external dependencies:
 * - ffmpeg for video processing
 * - Network access for real API calls
 * - Playwright for browser automation
 *
 * Run with: npm run test:integration
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Integration tests use .integration.test.ts suffix
    include: ["src/**/*.integration.test.ts"],
    // Longer timeouts for network/browser operations
    testTimeout: 60000,
    hookTimeout: 30000,
    // Run tests sequentially to avoid resource conflicts
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    coverage: {
      provider: "v8",
      // Output to separate directory for merging
      reportsDirectory: "./coverage-integration",
      reporter: ["lcov", "json"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.integration.test.ts",
        "src/**/index.ts",
      ],
    },
  },
});

