import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";
import {
  createJoshComeauSessionVerifier,
  hasJoshComeauCourseAccess,
  isJoshComeauLoginPage,
  JOSH_COMEAU_DOMAIN,
  JOSH_COMEAU_LOGIN_URL,
  type JoshComeauAccessIndicators,
} from "./auth.js";

describe("Josh Comeau auth", () => {
  it("uses the shared course dashboard as its login entry point", () => {
    expect(JOSH_COMEAU_DOMAIN).toBe("courses.joshwcomeau.com");
    expect(JOSH_COMEAU_LOGIN_URL).toBe("https://courses.joshwcomeau.com/");
  });

  it("recognizes auth callbacks without treating the dashboard as a login page", () => {
    expect(
      isJoshComeauLoginPage("https://courses.joshwcomeau.com/api/auth/email/verify?token=abc")
    ).toBe(true);
    expect(isJoshComeauLoginPage(JOSH_COMEAU_LOGIN_URL)).toBe(false);
    expect(isJoshComeauLoginPage("invalid")).toBe(false);
  });

  it.each([
    ["dashboard", { heading: "My Dashboard", hasDashboardCard: true }, true],
    ["unlocked lesson", { hasUnlockedLesson: true }, true],
    ["purchased curriculum", { hasCurriculum: true }, true],
    [
      "public curriculum preview",
      { hasCurriculum: true, bodyText: "Register for CSS for JavaScript Developers" },
      false,
    ],
    [
      "locked curriculum",
      { hasCurriculum: true, bodyText: "To unlock this course, please register." },
      false,
    ],
  ] as const)("detects %s access correctly", (_label, overrides, expected) => {
    const indicators: JoshComeauAccessIndicators = {
      heading: "",
      hasDashboardCard: false,
      hasCurriculum: false,
      hasUnlockedLesson: false,
      bodyText: "",
      ...overrides,
    };

    expect(hasJoshComeauCourseAccess(indicators)).toBe(expected);
  });

  it("does not navigate away during interactive login verification", async () => {
    const goto = vi.fn().mockResolvedValue(undefined);
    const page = {
      context: () => ({ pages: () => [page] }),
      evaluate: vi.fn().mockResolvedValue({
        heading: "",
        hasDashboardCard: false,
        hasCurriculum: false,
        hasUnlockedLesson: false,
        bodyText: "",
      }),
      goto,
      isClosed: vi.fn().mockReturnValue(false),
      url: vi.fn().mockReturnValue(JOSH_COMEAU_LOGIN_URL),
    } as unknown as Page;

    await createJoshComeauSessionVerifier("https://courses.joshwcomeau.com/css-for-js")(page, {
      allowNavigation: false,
    });

    expect(goto).not.toHaveBeenCalled();
  });

  it("navigates to the target course by default for cached-session verification", async () => {
    const goto = vi.fn().mockResolvedValue(undefined);
    const waitForLoadState = vi.fn().mockResolvedValue(undefined);
    const page = {
      context: () => ({ pages: () => [page] }),
      evaluate: vi.fn().mockResolvedValue({
        heading: "",
        hasDashboardCard: false,
        hasCurriculum: false,
        hasUnlockedLesson: false,
        bodyText: "",
      }),
      goto,
      isClosed: vi.fn().mockReturnValue(false),
      url: vi.fn().mockReturnValue(JOSH_COMEAU_LOGIN_URL),
      waitForLoadState,
    } as unknown as Page;

    await createJoshComeauSessionVerifier("https://courses.joshwcomeau.com/css-for-js")(page);

    expect(goto).toHaveBeenCalledWith("https://courses.joshwcomeau.com/css-for-js", {
      timeout: 30000,
    });
    expect(waitForLoadState).toHaveBeenCalledWith("domcontentloaded");
  });
});
