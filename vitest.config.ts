import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: [
        // Test files
        "src/**/*.test.ts",
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
        // Video downloaders (mostly network I/O, pure functions tested separately)
        "src/downloader/loomDownloader.ts",
        "src/downloader/vimeoDownloader.ts",
      ],
    },
  },
});
