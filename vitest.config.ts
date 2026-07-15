import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.integration.test.ts", "node_modules/**"],
    coverage: {
      provider: "istanbul",
      reportsDirectory: "./coverage",
      reporter: ["text", "html", "lcov", "json"],
      include: ["src/**/*.ts"],
      exclude: [
        // Test files
        "src/**/*.test.ts",
        "src/**/*.integration.test.ts",
        // Re-export index files. This also excludes the Commander entrypoint,
        // which parses process.argv on import; CLI command implementations stay included.
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
