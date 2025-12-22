import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["src/**/*.ts"],
    rules: {
      // Allow underscore-prefixed unused vars (common pattern)
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Allow numbers/booleans in template literals
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true },
      ],
      // Empty callbacks are fine (e.g., .catch(() => {}))
      "@typescript-eslint/no-empty-function": "off",
      // Defensive coding with optional chains is fine
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  {
    files: ["src/**/*.test.ts"],
    rules: {
      // Tests need more flexibility with mocks and fixtures
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/only-throw-error": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    files: ["*.config.js", "*.config.ts"],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
  {
    ignores: ["dist/**", "node_modules/**"],
  },
);
