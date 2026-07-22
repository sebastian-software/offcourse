import { errors, type Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import { waitForAttachedContent, waitForFrame } from "./waits.js";

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

  it("preserves best-effort behavior when the content wait times out", async () => {
    const timeout = new errors.TimeoutError("timed out");
    const waitFor = vi.fn().mockRejectedValue(timeout);
    const { page } = createPage(waitFor);

    await expect(waitForAttachedContent(page, "main")).resolves.toBeUndefined();
  });

  it("rethrows non-timeout content errors", async () => {
    const waitFor = vi.fn().mockRejectedValue(new Error("page closed"));
    const { page } = createPage(waitFor);

    await expect(waitForAttachedContent(page, "main")).rejects.toThrow("page closed");
  });

  it("waits for a matching frame attachment", async () => {
    const frame = { url: () => "https://player.vimeo.com/video/123" };
    const waitForEvent = vi.fn().mockResolvedValue(frame);
    const page = {
      frames: vi.fn().mockReturnValue([]),
      waitForEvent,
    } as unknown as Page;

    await expect(
      waitForFrame(page, (candidate) => candidate.url().includes("vimeo"), 4321)
    ).resolves.toBe(frame);
    expect(waitForEvent).toHaveBeenCalledWith(
      "frameattached",
      expect.objectContaining({ predicate: expect.any(Function), timeout: 4321 })
    );
    expect(waitForEvent).toHaveBeenCalledWith(
      "framenavigated",
      expect.objectContaining({ predicate: expect.any(Function), timeout: 4321 })
    );
  });
});
