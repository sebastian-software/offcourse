import type { Page } from "playwright";

/**
 * Waits for content that the caller is about to read, but preserves the
 * scraper's existing best-effort behavior when the condition times out.
 */
export async function waitForAttachedContent(
  page: Page,
  selector: string,
  timeout = 5000
): Promise<void> {
  await page
    .locator(selector)
    .first()
    .waitFor({ state: "attached", timeout })
    .catch(() => {});
}
