import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Include both unit tests (*.test.ts) and integration tests (*.integration.test.ts)
    include: ["src/**/*.test.ts", "src/**/*.integration.test.ts"],
    exclude: ["node_modules/**"],
    // Longer timeouts for integration tests with network/ffmpeg operations
    testTimeout: 60000,
    hookTimeout: 30000,
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      reporter: ["text", "html", "lcov", "json"],
      include: ["src/**/*.ts"],
      exclude: [
        // Test files
        "src/**/*.test.ts",
        "src/**/*.integration.test.ts",
        // CLI commands (interactive, hard to test)
        "src/cli/**",
        // Re-export index files
        "src/**/index.ts",
        // Pure I/O wrappers (testing would just test Node.js/packages)
        "src/shared/fs.ts",
        "src/config/configManager.ts",
        // Browser automation (requires Playwright, not unit testable)
        "src/scraper/videoInterceptor.ts",
        // Network validation (requires live connections)
        "src/downloader/hlsValidator.ts",
      ],
    },
  },
});
