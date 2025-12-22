import { describe, expect, it } from "vitest";
import { createLoginChecker, isSkoolLoginPage, isHighLevelLoginPage } from "./auth.js";

describe("auth", () => {
  describe("createLoginChecker", () => {
    it("creates checker that matches patterns", () => {
      const checker = createLoginChecker([/\/login/, /\/signin/]);

      expect(checker("https://example.com/login")).toBe(true);
      expect(checker("https://example.com/signin")).toBe(true);
      expect(checker("https://example.com/dashboard")).toBe(false);
    });

    it("uses default patterns when none provided", () => {
      const checker = createLoginChecker();

      expect(checker("https://example.com/login")).toBe(true);
      expect(checker("https://accounts.google.com/auth")).toBe(true);
      expect(checker("https://example.com/dashboard")).toBe(false);
    });
  });

  describe("isSkoolLoginPage", () => {
    it("detects Skool login page", () => {
      expect(isSkoolLoginPage("https://www.skool.com/login")).toBe(true);
    });

    it("detects Google OAuth redirect", () => {
      expect(isSkoolLoginPage("https://accounts.google.com/o/oauth2/auth?...")).toBe(true);
    });

    it("returns false for non-login pages", () => {
      expect(isSkoolLoginPage("https://www.skool.com/my-community")).toBe(false);
      expect(isSkoolLoginPage("https://www.skool.com/my-community/classroom")).toBe(false);
    });
  });

  describe("isHighLevelLoginPage", () => {
    it("detects HighLevel SSO page", () => {
      expect(isHighLevelLoginPage("https://sso.clientclub.net/login")).toBe(true);
    });

    it("detects various login paths", () => {
      expect(isHighLevelLoginPage("https://portal.example.com/login")).toBe(true);
      expect(isHighLevelLoginPage("https://portal.example.com/signin")).toBe(true);
      expect(isHighLevelLoginPage("https://portal.example.com/auth/callback")).toBe(true);
    });

    it("detects Firebase auth", () => {
      expect(isHighLevelLoginPage("https://example.firebaseapp.com/auth")).toBe(true);
    });

    it("returns false for content pages", () => {
      expect(isHighLevelLoginPage("https://portal.example.com/courses")).toBe(false);
      expect(isHighLevelLoginPage("https://portal.example.com/dashboard")).toBe(false);
    });
  });
});
