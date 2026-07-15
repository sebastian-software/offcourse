import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  browserClose: vi.fn(),
  clearSession: vi.fn(),
  getAuthenticatedSession: vi.fn(),
  hasValidSession: vi.fn(),
}));

vi.mock("../../shared/auth.js", () => ({
  clearSession: authMocks.clearSession,
  getAuthenticatedSession: authMocks.getAuthenticatedSession,
  hasValidSession: authMocks.hasValidSession,
  isSkoolLoginPage: (url: string) => url.includes("/login"),
}));

import { loginCommand } from "./login.js";

describe("loginCommand", () => {
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
});
