import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import {
  createLearningSuiteSessionVerifier,
  getLearningSuiteDomain,
  isLearningSuiteLoginPage,
  isLearningSuitePortal,
} from "./auth.js";

const courseUrl =
  "https://mrgenossenschaft.learningsuite.io/student/course/masterclass-genossenschaft/fmGcFzds";

describe("LearningSuite auth", () => {
  it("extracts and recognizes tenant-specific portal URLs", () => {
    expect(getLearningSuiteDomain(courseUrl)).toBe("mrgenossenschaft.learningsuite.io");
    expect(isLearningSuitePortal(courseUrl)).toBe(true);
    expect(isLearningSuitePortal("https://learningsuite.io/")).toBe(false);
    expect(isLearningSuitePortal("https://tenant.learningsuite.io.example.com/course")).toBe(false);
    expect(isLearningSuitePortal("invalid")).toBe(false);
  });

  it("recognizes LearningSuite and Google login pages", () => {
    expect(isLearningSuiteLoginPage("https://tenant.learningsuite.io/auth")).toBe(true);
    expect(isLearningSuiteLoginPage("https://accounts.google.com/signin/v2")).toBe(true);
    expect(isLearningSuiteLoginPage(courseUrl)).toBe(false);
  });

  it("accepts an authenticated course page on the requested tenant", async () => {
    const evaluate = vi.fn();
    const page = {
      url: vi.fn(() => courseUrl),
      evaluate,
    } as unknown as Page;

    const verify = createLearningSuiteSessionVerifier(courseUrl);

    await expect(verify(page)).resolves.toBe(true);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("rejects redirects to another LearningSuite tenant", async () => {
    const evaluate = vi.fn();
    const page = {
      url: vi.fn(() => "https://different.learningsuite.io/student/course/masterclass/fmGcFzds"),
      evaluate,
    } as unknown as Page;

    const verify = createLearningSuiteSessionVerifier(courseUrl);

    await expect(verify(page)).resolves.toBe(false);
    expect(evaluate).not.toHaveBeenCalled();
  });
});
