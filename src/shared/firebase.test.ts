import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import {
  FIREBASE_AUTH_KEY_PATTERN,
  getFirebaseAccessTokenFromPage,
  waitForFirebaseAccessTokenFromPage,
} from "./firebase.js";

function pageReturning(value: unknown): Page {
  return { evaluate: vi.fn().mockResolvedValue(value) } as unknown as Page;
}

describe("getFirebaseAccessTokenFromPage", () => {
  it("returns a validated Firebase access token", async () => {
    await expect(
      getFirebaseAccessTokenFromPage(
        pageReturning({
          stsTokenManager: {
            accessToken: "access-token",
            expirationTime: Date.now() + 60_000,
          },
        })
      )
    ).resolves.toBe("access-token");
  });

  it.each([null, {}, { stsTokenManager: {} }, { stsTokenManager: { accessToken: 123 } }])(
    "returns null for missing or invalid auth data",
    async (value) => {
      await expect(getFirebaseAccessTokenFromPage(pageReturning(value))).resolves.toBeNull();
    }
  );
});

describe("waitForFirebaseAccessTokenFromPage", () => {
  it("waits for Firebase initialization before reading the token", async () => {
    const waitForFunction = vi.fn().mockResolvedValue(undefined);
    const evaluate = vi.fn().mockResolvedValue({
      stsTokenManager: { accessToken: "access-token" },
    });
    const page = { waitForFunction, evaluate } as unknown as Page;

    await expect(waitForFirebaseAccessTokenFromPage(page, 1234)).resolves.toBe("access-token");
    expect(waitForFunction).toHaveBeenCalledWith(
      expect.any(Function),
      { keyPattern: FIREBASE_AUTH_KEY_PATTERN },
      { timeout: 1234 }
    );
  });

  it("falls back to an immediate token read after a timeout", async () => {
    const waitForFunction = vi.fn().mockRejectedValue(new Error("timed out"));
    const evaluate = vi.fn().mockResolvedValue(null);
    const page = { waitForFunction, evaluate } as unknown as Page;

    await expect(waitForFirebaseAccessTokenFromPage(page)).resolves.toBeNull();
  });
});
