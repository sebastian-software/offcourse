import type { Page } from "playwright";
import {
  detectVimeoEmbed,
  detectLoomEmbed,
  detectYouTubeEmbed,
  detectWistiaEmbed,
} from "../../shared/videoDetection.js";

export interface LearningSuiteVideoInfo {
  type: "hls" | "vimeo" | "loom" | "youtube" | "wistia" | "native" | "unknown";
  url: string;
  hlsUrl?: string;
  thumbnailUrl?: string;
  duration?: number;
}

export interface LearningSuitePostContent {
  id: string;
  title: string;
  description: string | null;
  htmlContent: string | null;
  video: LearningSuiteVideoInfo | null;
  attachments: {
    id: string;
    name: string;
    url: string;
    type: string;
    size?: number;
  }[];
}

// ============================================================================
// Pure Utility Functions (Testable)
// ============================================================================

/**
 * Detects the video type from a URL.
 */
export function detectVideoType(url: string): LearningSuiteVideoInfo["type"] {
  const lowerUrl = url.toLowerCase();

  if (lowerUrl.includes("vimeo.com") || lowerUrl.includes("player.vimeo")) {
    return "vimeo";
  }
  if (lowerUrl.includes("loom.com")) {
    return "loom";
  }
  if (lowerUrl.includes("youtube.com") || lowerUrl.includes("youtu.be")) {
    return "youtube";
  }
  if (lowerUrl.includes("wistia.com") || lowerUrl.includes("wistia.net")) {
    return "wistia";
  }
  if (lowerUrl.includes(".m3u8")) {
    return "hls";
  }
  if (lowerUrl.includes(".mp4") || lowerUrl.includes(".webm")) {
    return "native";
  }

  return "unknown";
}

/** Extracts the sequence number from LearningSuite's Bunny HLS segment URLs. */
export function getLearningSuiteSegmentIndex(url: string): number | null {
  const value = /(?:^|\/)video(\d+)\.ts(?:[?#]|$)/i.exec(url)?.[1];
  return value ? Number.parseInt(value, 10) : null;
}

function getLearningSuiteRenditionKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    const directory = parsed.pathname.replace(/video\d+\.ts$/i, "");
    return `${parsed.origin}${directory}`;
  } catch {
    return /^(.*\/)video\d+\.ts(?:[?#]|$)/i.exec(url)?.[1] ?? null;
  }
}

function getLearningSuiteRenditionHeight(renditionKey: string): number {
  const directory = renditionKey.replace(/\/+$/, "").split("/").at(-1) ?? "";
  const dimensions = /\d{3,4}x(\d{3,4})/i.exec(directory)?.[1];
  const namedHeight = /(?:^|[_-])(\d{3,4})p?(?:$|[_-])/i.exec(directory)?.[1];
  const height = dimensions ?? namedHeight;
  return height ? Number.parseInt(height, 10) : 0;
}

/**
 * Groups segment URLs by rendition, keeps refreshed tokens, and returns the
 * most complete rendition only when it covers every observed segment index.
 */
export function getCompleteLearningSuiteSegments(
  urls: string[],
  videoDuration?: number | null
): string[] | null {
  const renditions = new Map<string, Map<number, string>>();
  let lastObservedIndex = -1;

  for (const url of urls) {
    const index = getLearningSuiteSegmentIndex(url);
    const renditionKey = getLearningSuiteRenditionKey(url);
    if (index === null || renditionKey === null) continue;

    let segments = renditions.get(renditionKey);
    if (!segments) {
      segments = new Map<number, string>();
      renditions.set(renditionKey, segments);
    }
    segments.set(index, url);
    lastObservedIndex = Math.max(lastObservedIndex, index);
  }

  const selectedRendition = [...renditions.entries()].sort(
    ([keyA, segmentsA], [keyB, segmentsB]) =>
      segmentsB.size - segmentsA.size ||
      getLearningSuiteRenditionHeight(keyB) - getLearningSuiteRenditionHeight(keyA) ||
      keyA.localeCompare(keyB)
  )[0];
  const segmentsByIndex = selectedRendition?.[1];
  if (!segmentsByIndex || lastObservedIndex < 0) return null;

  const segments: string[] = [];
  for (let index = 0; index <= lastObservedIndex; index++) {
    const url = segmentsByIndex.get(index);
    if (!url) return null;
    segments.push(url);
  }

  // Bunny currently uses roughly four-second segments. This generous upper
  // bound prevents a lone startup segment from being treated as a full video
  // when seeking failed before the final segment could be observed.
  if (videoDuration && Number.isFinite(videoDuration) && videoDuration / segments.length > 8) {
    return null;
  }

  return segments;
}

export interface LearningSuiteBunnyPayload {
  segmentUrls: string[];
  hlsUrls: string[];
}

/** Extracts usable Bunny playlist and segment URLs from playlist or API response text. */
export function parseLearningSuiteBunnyPayload(text: string): LearningSuiteBunnyPayload {
  const normalized = text.replaceAll("\\/", "/").replaceAll("&amp;", "&");
  const segmentUrls: string[] = [];
  const hlsUrls: string[] = [];
  const addUnique = (values: string[], value: string) => {
    if (!values.includes(value)) values.push(value);
  };

  if (normalized.trimStart().startsWith("#EXTM3U")) {
    const lines = normalized.split("\n").map((line) => line.trim());
    const firstAbsoluteCdnUrl = lines.find(
      (line) => /^https?:\/\//i.test(line) && line.includes("b-cdn.net")
    );
    let baseUrl: string | null = null;
    if (firstAbsoluteCdnUrl) {
      try {
        baseUrl = new URL(".", firstAbsoluteCdnUrl).toString();
      } catch {
        baseUrl = null;
      }
    }

    for (const line of lines) {
      if (!line || line.startsWith("#") || !line.includes(".ts")) continue;

      if (/^https?:\/\//i.test(line)) {
        addUnique(segmentUrls, line);
      } else if (baseUrl && line.includes("token=")) {
        try {
          addUnique(segmentUrls, new URL(line, baseUrl).toString());
        } catch {
          // Ignore malformed relative segment URLs.
        }
      }
    }

    const firstBunnySegment = segmentUrls.find((url) => /\/video\d+\.ts(?:[?#]|$)/i.test(url));
    if (firstBunnySegment) {
      try {
        addUnique(hlsUrls, new URL("playlist.m3u8", firstBunnySegment).toString());
      } catch {
        // The generic URL scan below may still find a playlist URL.
      }
    }
  }

  const cdnUrlRegex = /https?:\/\/vz-[^"'\s<>]+\.b-cdn\.net[^"'\s<>]*/gi;
  for (const match of normalized.matchAll(cdnUrlRegex)) {
    const url = match[0];
    if (/\.m3u8(?:[?#]|$)/i.test(url)) addUnique(hlsUrls, url);
    if (/\.ts(?:[?#]|$)/i.test(url)) addUnique(segmentUrls, url);
  }

  return { segmentUrls, hlsUrls };
}

// ============================================================================
// Browser/API Automation (Playwright-dependent)
// ============================================================================

/**
 * Extracts video information from a lesson page.
 */
export async function extractVideoFromPage(page: Page): Promise<LearningSuiteVideoInfo | null> {
  // Helper to check if URL is a valid video URL (real CDN, not API proxy)
  const isValidVideoUrl = (url: string): boolean => {
    // REJECT API proxy URLs - they don't work outside the browser
    if (url.includes("api.learningsuite.io")) {
      return false;
    }
    // Accept actual CDN URLs
    return (
      url.includes("b-cdn.net") ||
      url.includes("mediadelivery.net") ||
      url.includes("vz-") ||
      url.includes("bunnycdn") ||
      // Also accept other m3u8 URLs that are not from learningsuite
      (!url.includes("learningsuite.io") && url.includes(".m3u8"))
    );
  };

  // Check for HLS video
  const hlsUrl = await page.evaluate(() => {
    // Look for video elements with HLS source
    const videos = Array.from(document.querySelectorAll("video"));
    for (const video of videos) {
      const src = video.currentSrc ?? video.src;
      if (src?.includes(".m3u8")) {
        return src;
      }
    }

    // Check for HLS source elements
    const sources = Array.from(
      document.querySelectorAll('source[type*="m3u8"], source[src*=".m3u8"]')
    );
    for (const source of sources) {
      const src = (source as HTMLSourceElement).src;
      if (src) return src;
    }

    // Look for HLS URLs in script tags - prefer CDN URLs
    const scripts = Array.from(document.querySelectorAll("script"));
    for (const script of scripts) {
      const content = script.textContent ?? "";
      // Look for Bunny CDN URLs first
      const cdnMatch =
        /(https?:\/\/[^"'\s]*(?:b-cdn\.net|mediadelivery\.net|vz-)[^"'\s]*\.m3u8[^"'\s]*)/i.exec(
          content
        );
      if (cdnMatch?.[1]) return cdnMatch[1];
    }

    // Fallback to any m3u8 URL in scripts (will be filtered later)
    for (const script of scripts) {
      const content = script.textContent ?? "";
      const hlsMatch = /"(https?:\/\/[^"]+\.m3u8[^"]*)"/i.exec(content);
      if (hlsMatch?.[1]) return hlsMatch[1];
    }

    return null;
  });

  // Check if URL is valid
  if (hlsUrl && isValidVideoUrl(hlsUrl)) {
    return {
      type: "hls",
      url: hlsUrl,
      hlsUrl,
    };
  }

  // Check for embedded videos using shared detection
  const vimeoUrl = await detectVimeoEmbed(page);
  if (vimeoUrl) {
    return { type: "vimeo", url: vimeoUrl };
  }

  const loomUrl = await detectLoomEmbed(page);
  if (loomUrl) {
    return { type: "loom", url: loomUrl };
  }

  const youtubeUrl = await detectYouTubeEmbed(page);
  if (youtubeUrl) {
    return { type: "youtube", url: youtubeUrl };
  }

  const wistiaInfo = await detectWistiaEmbed(page);
  if (wistiaInfo?.id) {
    return { type: "wistia", url: `https://fast.wistia.net/embed/medias/${wistiaInfo.id}` };
  }

  // Check for native video
  const nativeVideoUrl = await page.evaluate(() => {
    const video = document.querySelector("video");
    if (video) {
      const source = video.querySelector("source");
      const src = source?.src ?? video.src ?? video.currentSrc;
      if (src && !src.includes(".m3u8") && /^https?:\/\//i.test(src)) {
        return src;
      }
    }
    return null;
  });

  if (nativeVideoUrl) {
    return {
      type: "native",
      url: nativeVideoUrl,
    };
  }

  return null;
}

/**
 * Extracts HTML content from the lesson page using semantic HTML structure.
 * Uses accessibility-friendly selectors: main element, semantic headings, paragraphs, lists.
 * Falls back to data-* attributes which are also stable.
 */
export async function extractHtmlContent(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    // Find the main content area (semantic HTML)
    const main = document.querySelector("main");
    if (!main) return null;

    // Find content elements using semantic selectors first, then data attributes as fallback
    // Priority: semantic HTML (p, ul, ol in main) > data-slate-node > data-cy attributes
    const contentElements = main.querySelectorAll(
      // Semantic HTML within main
      "p[data-slate-node], ul[data-slate-node], ol[data-slate-node], " +
        // Stable data attributes as fallback
        '[data-cy="paragraph-element"], [data-cy="list-item"]'
    );

    if (contentElements.length > 0) {
      const htmlParts: string[] = [];
      const processedTexts = new Set<string>();

      for (const el of Array.from(contentElements)) {
        const tag = el.tagName.toLowerCase();
        const text = el.textContent?.trim() ?? "";

        // Skip empty, duplicate, or very short text
        if (!text || processedTexts.has(text) || text.length < 3) continue;
        processedTexts.add(text);

        if (tag === "p") {
          htmlParts.push(`<p>${text}</p>`);
        } else if (tag === "ul" || tag === "ol") {
          const items = el.querySelectorAll("li");
          const listItems = Array.from(items)
            .map((li) => li.textContent?.trim() ?? "")
            .filter((t) => t.length > 0)
            .map((t) => `<li>${t}</li>`)
            .join("");
          if (listItems) {
            htmlParts.push(`<${tag}>${listItems}</${tag}>`);
          }
        }
      }

      if (htmlParts.length > 0) {
        return htmlParts.join("\n");
      }
    }

    // Fallback: extract from main, excluding navigation and interactive elements
    const clone = main.cloneNode(true) as HTMLElement;

    // Remove non-content elements using semantic/role selectors
    const unwanted = clone.querySelectorAll(
      "script, style, nav, video, iframe, svg, button, input, " +
        '[role="navigation"], [role="button"], [role="menuitem"], [role="menu"]'
    );
    unwanted.forEach((el) => {
      el.remove();
    });

    const text = clone.textContent?.trim();
    if (text && text.length > 50) {
      return `<p>${text}</p>`;
    }

    return null;
  });
}

/**
 * Extracts attachments/materials from the lesson page.
 */
export async function extractAttachmentsFromPage(
  page: Page
): Promise<LearningSuitePostContent["attachments"]> {
  return page.evaluate(() => {
    const attachments: {
      id: string;
      name: string;
      url: string;
      type: string;
      size?: number;
    }[] = [];

    // Look for download links - include storage URLs (Google Cloud Storage)
    const downloadLinks = document.querySelectorAll(
      'a[download], a[href*=".pdf"], a[href*=".doc"], a[href*=".xls"], a[href*=".ppt"], a[href*=".zip"], a[href*="storage.googleapis.com"], a[href*="storage.cloud.google"]'
    );

    const seen = new Set<string>();

    for (const link of Array.from(downloadLinks)) {
      const anchor = link as HTMLAnchorElement;
      const url = anchor.href;

      if (!url || seen.has(url)) continue;

      // Skip non-file URLs
      if (url.startsWith("javascript:") || url.startsWith("#")) continue;

      seen.add(url);

      // Get filename from download attribute, text content, or URL
      let name = anchor.download || "";
      if (!name) {
        // Try to get name from visible text (often the file name is shown)
        const textContent = anchor.textContent?.trim() ?? "";
        if (textContent?.includes(".")) {
          name = textContent;
        }
      }
      if (!name) {
        // Extract from URL, handling encoded characters
        const urlParts = url.split("/");
        const lastPart = urlParts[urlParts.length - 1]?.split("?")[0] ?? "";
        try {
          name = decodeURIComponent(lastPart);
        } catch {
          name = lastPart;
        }
      }
      if (!name) {
        name = "attachment";
      }

      // Determine type from extension
      const ext = name.split(".").pop()?.toLowerCase() ?? "";
      let type = "file";
      if (["pdf"].includes(ext)) type = "pdf";
      else if (["doc", "docx"].includes(ext)) type = "document";
      else if (["xls", "xlsx"].includes(ext)) type = "spreadsheet";
      else if (["ppt", "pptx"].includes(ext)) type = "presentation";
      else if (["zip", "rar", "7z"].includes(ext)) type = "archive";
      else if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) type = "image";

      attachments.push({
        id: `attachment-${attachments.length}`,
        name,
        url,
        type,
      });
    }

    return attachments;
  });
}

/**
 * Extracts complete lesson content using DOM-based extraction with network interception.
 *
 * ## Video Download Strategy for LearningSuite (Bunny CDN)
 *
 * LearningSuite uses encrypted HLS playlists that cannot be downloaded directly:
 *
 * 1. **Encrypted Playlists**: The API returns encrypted data (e.g., `77a393e51f4b...`)
 *    instead of standard `#EXTM3U` playlists. JavaScript decrypts them client-side.
 *
 * 2. **Per-Segment Tokens**: Each `.ts` segment has a unique, short-lived token.
 *    These tokens are generated when the browser requests each segment.
 *
 * 3. **On-Demand Loading**: HLS players load segments on-demand during playback.
 *    Simply loading the page only captures the first ~2 minutes of video.
 *
 * ## Our Solution
 *
 * - Intercept network requests to capture segment URLs with their tokens
 * - Programmatically seek through the entire video timeline
 * - This triggers the player to request ALL segments
 * - Download each segment individually with its token
 * - Concatenate segments using `ffmpeg -f concat`
 *
 * ## Reusability
 *
 * This implementation is LearningSuite-specific due to additional playlist response parsing.
 * For other platforms with encrypted HLS, use the generic `captureEncryptedHLSSegments()`
 * function from `videoInterceptor.ts` which handles the core capture logic.
 *
 * Note: LearningSuite uses persisted GraphQL queries, so we can't make arbitrary API calls.
 */
export async function extractLearningSuitePostContent(
  page: Page,
  lessonUrl: string,
  _tenantId: string,
  _courseId: string,
  lessonId: string
): Promise<LearningSuitePostContent | null> {
  // Set up request interception to capture HLS video URLs
  const hlsUrls: string[] = [];

  // Capture segment URLs with their individual auth tokens
  // Each .ts segment has a unique token like: video0.ts?token=abc123&expires=...
  const segmentUrls: string[] = [];

  const requestHandler = (request: { url: () => string }) => {
    const url = request.url();

    // Capture .ts segment URLs with tokens - these are the actual video data
    if (url.includes("b-cdn.net") && url.includes(".ts")) {
      if (!segmentUrls.includes(url)) {
        segmentUrls.push(url);
      }
    }

    // Also capture direct CDN .m3u8 URLs if they ever appear
    if (url.includes("vz-") && url.includes("b-cdn.net") && url.includes(".m3u8")) {
      if (!hlsUrls.includes(url)) {
        hlsUrls.unshift(url);
      }
    }
  };

  // Handler for responses - capture Bunny CDN URLs from API responses
  const responseHandler = async (response: {
    url: () => string;
    status: () => number;
    text: () => Promise<string>;
    headers: () => Record<string, string>;
  }) => {
    const url = response.url();

    // Check API proxy responses for CDN URLs
    if (
      url.includes("api.learningsuite.io") &&
      url.includes("/bunny/") &&
      url.includes("playlist")
    ) {
      try {
        const status = response.status();

        // Check for redirect headers
        if (status >= 300 && status < 400) {
          const headers = response.headers();
          const location = headers.location;
          if (location?.includes("b-cdn.net")) {
            if (!hlsUrls.includes(location)) {
              hlsUrls.unshift(location); // Priority
            }
          }
          return;
        }

        if (status === 200) {
          const text = await response.text();
          const parsed = parseLearningSuiteBunnyPayload(text);
          for (const segmentUrl of parsed.segmentUrls) {
            if (!segmentUrls.includes(segmentUrl)) segmentUrls.push(segmentUrl);
          }
          hlsUrls.unshift(...parsed.hlsUrls.filter((url) => !hlsUrls.includes(url)));
        }
      } catch {
        // Response body might not be readable
      }
    }
  };

  page.on("request", requestHandler);
  page.on("response", responseHandler);

  // Navigate to lesson page
  await page.goto(lessonUrl, { timeout: 30000 });
  await page.waitForLoadState("domcontentloaded");

  // Wait for video player to appear (if any)
  const hasVideoPlayer = await page
    .locator("video, [class*='video'], [class*='Video'], [class*='player'], [class*='Player']")
    .first()
    .waitFor({ state: "attached", timeout: 5000 })
    .then(() => true)
    .catch(() => false);

  let videoDuration: number | null = null;

  // If video player exists, trigger video load and seek to capture ALL segments
  if (hasVideoPlayer) {
    // Try clicking play button first
    const playButton = page.locator(
      '[aria-label*="play" i], [class*="play" i], button[class*="Play"], [data-testid*="play"]'
    );
    try {
      await playButton.first().click({ timeout: 2000 });
      await page.waitForTimeout(2000);
    } catch {
      // Play button not found, try clicking video directly
      try {
        await page.locator("video").first().click({ timeout: 2000 });
        await page.waitForTimeout(2000);
      } catch {
        // Video not clickable
      }
    }

    // Playwright locators pierce open Shadow DOM. LearningSuite's current player
    // renders its <video> there, so document.querySelector("video") cannot find it.
    const videoLocator = page.locator("video").first();

    // Get video duration and seek to multiple positions to capture all segments.
    // A three-second interval is shorter than Bunny's roughly four-second
    // segments, ensuring that every segment gets requested at least once.
    try {
      if ((await videoLocator.count()) > 0) {
        videoDuration = await videoLocator.evaluate(
          (video) => (video as HTMLVideoElement).duration || 0
        );
      }

      if (videoDuration !== null && videoDuration > 0) {
        const seekPositions: number[] = [];

        for (let t = 0; t < videoDuration; t += 3) {
          seekPositions.push(t);
        }
        seekPositions.push(Math.max(0, videoDuration - 0.5));

        for (const seekTime of seekPositions) {
          await videoLocator.evaluate((video, time) => {
            (video as HTMLVideoElement).currentTime = time;
          }, seekTime);
          await page.waitForTimeout(250);
        }

        await videoLocator.evaluate((video) => {
          (video as HTMLVideoElement).currentTime = 0;
        });
        await page.waitForTimeout(500);
      }
    } catch {
      // Seek failed
    }

    // Give more time for all segment requests to complete
    await page.waitForTimeout(1500);
  }

  // Remove handlers
  page.off("request", requestHandler);
  page.off("response", responseHandler);

  const completeSegments = getCompleteLearningSuiteSegments(segmentUrls, videoDuration);

  // Try to get video from intercepted requests first
  let video: LearningSuiteVideoInfo | null = null;

  // Use captured segment URLs if we have them (LearningSuite's encrypted HLS)
  if (completeSegments) {
    // Create a special URL that contains the segments as a data URL
    // The downloader will handle this specially
    const segmentData = JSON.stringify(completeSegments);
    const segmentUrl = `segments:${Buffer.from(segmentData).toString("base64")}`;
    video = {
      type: "hls", // We'll handle this in the downloader
      url: segmentUrl,
      hlsUrl: segmentUrl,
    };
  }

  // Fallback to direct HLS URLs if available
  if (!video) {
    const firstHlsUrl = hlsUrls[0];
    if (firstHlsUrl) {
      video = {
        type: "hls",
        url: firstHlsUrl,
        hlsUrl: firstHlsUrl,
      };
    }
  }

  // Fallback to DOM extraction if no HLS found
  video ??= await extractVideoFromPage(page);

  const htmlContent = await extractHtmlContent(page);
  const attachments = await extractAttachmentsFromPage(page);

  // Get title from page using semantic HTML structure
  // The lesson title is typically an h3 within the main element
  const title = await page.evaluate(() => {
    const main = document.querySelector("main");

    // Find h3 heading within main (lesson title is usually h3)
    if (main) {
      const h3 = main.querySelector("h3");
      if (h3?.textContent?.trim()) {
        return h3.textContent.trim();
      }
    }

    // Try breadcrumb navigation (last item is the current page)
    const breadcrumb = document.querySelector(
      'nav[aria-label*="breadcrumb"], [role="navigation"] li:last-child'
    );
    if (breadcrumb?.textContent?.trim()) {
      return breadcrumb.textContent.trim();
    }

    // Try any h3 on the page
    const h3 = document.querySelector("h3");
    if (h3?.textContent?.trim()) {
      return h3.textContent.trim();
    }

    // Try h1 as fallback
    const h1 = document.querySelector("h1");
    if (h1?.textContent?.trim()) {
      return h1.textContent.trim();
    }

    // Use page title as last resort
    return document.title.split(" - ")[0] ?? "Untitled";
  });

  return {
    id: lessonId,
    title,
    description: null,
    htmlContent,
    video,
    attachments,
  };
}
