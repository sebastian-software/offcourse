import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import { getFirebaseAccessTokenFromPage } from "./firebase.js";

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
