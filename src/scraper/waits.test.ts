import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import { waitForAttachedContent, waitForVisibleContent } from "./waits.js";

function createPage(waitFor: ReturnType<typeof vi.fn>): {
  page: Page;
  locator: ReturnType<typeof vi.fn>;
} {
  const first = vi.fn().mockReturnValue({ waitFor });
  const locator = vi.fn().mockReturnValue({ first });
  return { page: { locator } as unknown as Page, locator };
}

describe("scraper content waits", () => {
  it("waits for attached content with the requested timeout", async () => {
    const waitFor = vi.fn().mockResolvedValue(undefined);
    const { page, locator } = createPage(waitFor);

    await waitForAttachedContent(page, "main, article", 1234);

    expect(locator).toHaveBeenCalledWith("main, article");
    expect(waitFor).toHaveBeenCalledWith({ state: "attached", timeout: 1234 });
  });

  it("waits for visible content and treats timeout as a best-effort fallback", async () => {
    const waitFor = vi.fn().mockRejectedValue(new Error("timed out"));
    const { page } = createPage(waitFor);

    await expect(waitForVisibleContent(page, "video")).resolves.toBeUndefined();
    expect(waitFor).toHaveBeenCalledWith({ state: "visible", timeout: 5000 });
  });
});
