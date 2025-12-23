import type { Page } from "playwright";

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
// Browser/API Automation
// ============================================================================
/* v8 ignore start */

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

/**
 * Extracts video information from a lesson page.
 */
export async function extractVideoFromPage(page: Page): Promise<LearningSuiteVideoInfo | null> {
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

    // Look for HLS URLs in script tags
    const scripts = Array.from(document.querySelectorAll("script"));
    for (const script of scripts) {
      const content = script.textContent ?? "";
      const hlsMatch = /"(https?:\/\/[^"]+\.m3u8[^"]*)"/i.exec(content);
      if (hlsMatch?.[1]) return hlsMatch[1];
    }

    return null;
  });

  if (hlsUrl) {
    return {
      type: "hls",
      url: hlsUrl,
      hlsUrl,
    };
  }

  // Check for Vimeo embed
  const vimeoUrl = await page.evaluate(() => {
    const iframe = document.querySelector('iframe[src*="vimeo.com"], iframe[src*="player.vimeo"]');
    if (iframe) {
      return (iframe as HTMLIFrameElement).src;
    }
    return null;
  });

  if (vimeoUrl) {
    return {
      type: "vimeo",
      url: vimeoUrl,
    };
  }

  // Check for Loom embed
  const loomUrl = await page.evaluate(() => {
    const iframe = document.querySelector('iframe[src*="loom.com"]');
    if (iframe) {
      return (iframe as HTMLIFrameElement).src;
    }
    return null;
  });

  if (loomUrl) {
    return {
      type: "loom",
      url: loomUrl,
    };
  }

  // Check for YouTube embed
  const youtubeUrl = await page.evaluate(() => {
    const iframe = document.querySelector(
      'iframe[src*="youtube.com"], iframe[src*="youtube-nocookie.com"], iframe[src*="youtu.be"]'
    );
    if (iframe) {
      return (iframe as HTMLIFrameElement).src;
    }
    return null;
  });

  if (youtubeUrl) {
    return {
      type: "youtube",
      url: youtubeUrl,
    };
  }

  // Check for Wistia
  const wistiaInfo = await page.evaluate(() => {
    const wistiaEmbed = document.querySelector('[class*="wistia"]');
    if (wistiaEmbed) {
      const match = /wistia_embed wistia_async_(\w+)/.exec(wistiaEmbed.className);
      if (match?.[1]) {
        return { id: match[1] };
      }
    }
    return null;
  });

  if (wistiaInfo?.id) {
    return {
      type: "wistia",
      url: `https://fast.wistia.net/embed/medias/${wistiaInfo.id}`,
    };
  }

  // Check for native video
  const nativeVideoUrl = await page.evaluate(() => {
    const video = document.querySelector("video");
    if (video) {
      const source = video.querySelector("source");
      const src = source?.src ?? video.src ?? video.currentSrc;
      if (src && !src.includes(".m3u8")) {
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
  const requestHandler = (request: { url: () => string }) => {
    const url = request.url();
    // Capture actual HLS playlists from Bunny CDN or direct m3u8 files
    // Prioritize actual .m3u8 files over API endpoints
    if (
      url.includes(".m3u8") || // Direct HLS playlist
      url.includes("b-cdn.net") || // Bunny CDN
      url.includes("mediadelivery.net") // Bunny video delivery
    ) {
      // Skip API responses, only capture actual playlist URLs
      if (!url.includes("/embed/") && !url.includes("/play/")) {
        hlsUrls.push(url);
      }
    }
  };

  page.on("request", requestHandler);

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

  // If video player exists but no HLS URL captured yet, try to trigger video load
  if (hasVideoPlayer && hlsUrls.length === 0) {
    // Try clicking play button or video element to trigger load
    const playButton = page.locator(
      '[aria-label*="play" i], [aria-label*="Play" i], [class*="play" i], button[class*="Play"], video'
    );

    try {
      await playButton.first().click({ timeout: 2000 });
      // Wait for HLS URL to be captured after clicking play
      await page.waitForTimeout(2000);
    } catch {
      // Play button not found or not clickable, continue anyway
    }
  }

  // Give a bit more time for lazy-loaded videos
  if (hlsUrls.length === 0 && hasVideoPlayer) {
    await page.waitForTimeout(2000);
  }

  // Remove handler
  page.off("request", requestHandler);

  // Try to get video from intercepted requests first
  let video: LearningSuiteVideoInfo | null = null;

  // Prioritize actual .m3u8 files from CDN
  const actualPlaylist = hlsUrls.find(
    (url) =>
      url.includes(".m3u8") && (url.includes("b-cdn.net") || url.includes("mediadelivery.net"))
  );

  if (actualPlaylist) {
    video = {
      type: "hls",
      url: actualPlaylist,
      hlsUrl: actualPlaylist,
    };
  } else if (hlsUrls.length > 0 && hlsUrls[0]) {
    // Fallback to any captured HLS URL
    video = {
      type: "hls",
      url: hlsUrls[0],
      hlsUrl: hlsUrls[0],
    };
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

/**
 * Intercepts network requests to capture video URLs during page load.
 */
export async function interceptVideoRequests(
  page: Page,
  lessonUrl: string
): Promise<LearningSuiteVideoInfo | null> {
  const hlsUrls: string[] = [];
  const videoUrls: string[] = [];

  // Set up request interception
  const requestHandler = (request: { url: () => string }) => {
    const url = request.url();

    // Capture HLS playlists
    if (url.includes(".m3u8") || url.includes("master.m3u8")) {
      hlsUrls.push(url);
    }

    // Capture video files
    if (url.includes(".mp4") || url.includes(".webm")) {
      videoUrls.push(url);
    }
  };

  page.on("request", requestHandler);

  // Navigate to the lesson
  await page.goto(lessonUrl, { timeout: 30000 });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(3000);

  // Remove handler
  page.off("request", requestHandler);

  // Return the best URL found
  const masterPlaylist = hlsUrls.find((url) => url.includes("master.m3u8"));
  if (masterPlaylist) {
    return {
      type: "hls",
      url: masterPlaylist,
      hlsUrl: masterPlaylist,
    };
  }

  if (hlsUrls.length > 0 && hlsUrls[0]) {
    return {
      type: "hls",
      url: hlsUrls[0],
      hlsUrl: hlsUrls[0],
    };
  }

  if (videoUrls.length > 0 && videoUrls[0]) {
    return {
      type: "native",
      url: videoUrls[0],
    };
  }

  // Fallback to DOM extraction
  return extractVideoFromPage(page);
}
/* v8 ignore stop */
