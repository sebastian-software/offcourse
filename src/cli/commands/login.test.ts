import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  browserClose: vi.fn(),
  clearSession: vi.fn(),
  getAuthenticatedSession: vi.fn(),
  hasValidSession: vi.fn(),
}));

vi.mock("../../shared/auth.js", () => ({
  clearSession: authMocks.clearSession,
  createLoginChecker:
    (patterns: RegExp[]) =>
    (url: string): boolean =>
      patterns.some((pattern) => pattern.test(url)),
  getAuthenticatedSession: authMocks.getAuthenticatedSession,
  hasValidSession: authMocks.hasValidSession,
  isSkoolLoginPage: (url: string) => url.includes("/login"),
}));

import { loginCommand, logoutCommand } from "./login.js";

describe("login and logout commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    authMocks.hasValidSession.mockResolvedValue(true);
    authMocks.getAuthenticatedSession.mockResolvedValue({
      browser: { close: authMocks.browserClose },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("verifies a cached Skool session against the requested community", async () => {
    await loginCommand("https://www.skool.com/cashflow-immobile/classroom", {});

    expect(authMocks.getAuthenticatedSession).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: "www.skool.com",
        loginUrl: "https://www.skool.com/login",
        verifySession: expect.any(Function),
      }),
      { headless: false }
    );
    expect(authMocks.browserClose).toHaveBeenCalledOnce();
  });

  it("keeps the existing global Skool login shortcut when no URL is provided", async () => {
    await loginCommand(undefined, {});

    expect(authMocks.getAuthenticatedSession).not.toHaveBeenCalled();
  });

  it("uses the requested LearningSuite tenant and course for login", async () => {
    const url =
      "https://mrgenossenschaft.learningsuite.io/student/course/masterclass-genossenschaft/fmGcFzds";

    await loginCommand(url, {});

    expect(authMocks.getAuthenticatedSession).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: "mrgenossenschaft.learningsuite.io",
        loginUrl: url,
        isLoginPage: expect.any(Function),
        verifySession: expect.any(Function),
      }),
      { headless: false }
    );
    expect(authMocks.browserClose).toHaveBeenCalledOnce();
  });

  it("clears only the requested LearningSuite tenant session", async () => {
    authMocks.clearSession.mockResolvedValue(true);

    await logoutCommand(
      "https://mrgenossenschaft.learningsuite.io/student/course/masterclass-genossenschaft/fmGcFzds"
    );

    expect(authMocks.clearSession).toHaveBeenCalledWith("mrgenossenschaft.learningsuite.io");
  });
});
