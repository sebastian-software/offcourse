import { errors, type Frame, type Page } from "playwright";

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
    .catch((error: unknown) => {
      if (error instanceof errors.TimeoutError) return;
      throw error;
    });
}

/**
 * Returns an already attached frame or waits for a matching frame to attach.
 * A missing frame is a normal best-effort result; browser failures still surface.
 */
export async function waitForFrame(
  page: Page,
  predicate: (frame: Frame) => boolean,
  timeout = 5000
): Promise<Frame | null> {
  const attachedFrame = page.frames().find(predicate);
  if (attachedFrame) return attachedFrame;

  try {
    return await page.waitForEvent("frameattached", { predicate, timeout });
  } catch (error: unknown) {
    if (error instanceof errors.TimeoutError) return null;
    throw error;
  }
}
