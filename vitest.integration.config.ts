import { defineConfig } from "vitest/config";
import unitConfig from "./vitest.config.js";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 60000,
    hookTimeout: 30000,
    coverage: {
      ...unitConfig.test?.coverage,
      reportsDirectory: "./coverage-integration",
    },
  },
});
