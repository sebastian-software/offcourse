import type { Browser, BrowserContext, Page } from "playwright";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  chromiumLaunch: vi.fn(),
  pathExists: vi.fn(),
  readJson: vi.fn(),
}));

vi.mock("playwright", () => ({
  chromium: { launch: mocks.chromiumLaunch },
}));

vi.mock("./fs.js", () => ({
  ensureDir: vi.fn(),
  outputJson: vi.fn(),
  pathExists: mocks.pathExists,
  readJson: mocks.readJson,
  removeFile: vi.fn(),
}));

import { getAuthenticatedSession, performInteractiveLogin } from "./auth.js";

describe("authenticated browser sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads cached storage with a standard Chromium user agent when requested", async () => {
    const storageState = { cookies: [], origins: [] };
    const probePage = {
      evaluate: vi
        .fn()
        .mockResolvedValue(
          "Mozilla/5.0 AppleWebKit/537.36 HeadlessChrome/141.0.7390.0 Safari/537.36"
        ),
    } as unknown as Page;
    const closeProbeContext = vi.fn().mockResolvedValue(undefined);
    const probeContext = {
      newPage: vi.fn().mockResolvedValue(probePage),
      close: closeProbeContext,
    } as unknown as BrowserContext;
    const sessionPage = {
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      url: vi.fn().mockReturnValue("https://courses.example.com/dashboard"),
    } as unknown as Page;
    const sessionContext = {
      newPage: vi.fn().mockResolvedValue(sessionPage),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as BrowserContext;
    const newContext = vi
      .fn()
      .mockResolvedValueOnce(probeContext)
      .mockResolvedValueOnce(sessionContext);
    const browser = {
      newContext,
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as Browser;
    const verifySession = vi.fn().mockResolvedValue(true);

    mocks.pathExists.mockResolvedValue(true);
    mocks.readJson.mockResolvedValue(storageState);
    mocks.chromiumLaunch.mockResolvedValue(browser);

    const authenticated = await getAuthenticatedSession(
      {
        domain: "courses.example.com",
        loginUrl: "https://courses.example.com/dashboard",
        isLoginPage: () => false,
        verifySession,
      },
      { headless: true, useStandardBrowserUserAgent: true }
    );

    expect(newContext).toHaveBeenNthCalledWith(1);
    expect(newContext).toHaveBeenNthCalledWith(2, {
      storageState,
      userAgent: "Mozilla/5.0 AppleWebKit/537.36 Chrome/141.0.7390.0 Safari/537.36",
    });
    expect(closeProbeContext).toHaveBeenCalledOnce();
    expect(verifySession).toHaveBeenCalledWith(sessionPage);
    expect(authenticated).toEqual({
      browser,
      session: { context: sessionContext, page: sessionPage },
      usedCachedSession: true,
    });
  });

  it("disables verifier navigation during interactive login", async () => {
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      url: vi.fn().mockReturnValue("https://courses.example.com/"),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    } as unknown as Page;
    const context = {
      newPage: vi.fn().mockResolvedValue(page),
      storageState: vi.fn().mockResolvedValue({ cookies: [], origins: [] }),
    } as unknown as BrowserContext;
    const browser = {
      newContext: vi.fn().mockResolvedValue(context),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as Browser;
    const verifySession = vi.fn().mockResolvedValue(true);

    mocks.chromiumLaunch.mockResolvedValue(browser);

    await performInteractiveLogin({
      domain: "courses.example.com",
      loginUrl: "https://courses.example.com/",
      isLoginPage: () => false,
      verifySession,
    });

    expect(verifySession).toHaveBeenCalledWith(page, { allowNavigation: false });
  });
});
