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
 * Extracts HTML content from the lesson page.
 */
export async function extractHtmlContent(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    // Look for content containers
    const contentSelectors = [
      '[class*="lesson-content"]',
      '[class*="LessonContent"]',
      '[class*="post-content"]',
      '[class*="PostContent"]',
      '[class*="content-body"]',
      '[class*="ContentBody"]',
      "article",
      '[class*="prose"]',
      "main [class*='content']",
    ];

    for (const selector of contentSelectors) {
      const element = document.querySelector(selector);
      if (element?.textContent && element.textContent.trim().length > 50) {
        // Clone to avoid modifying the page
        const clone = element.cloneNode(true) as HTMLElement;

        // Remove video elements, nav, scripts, styles
        const unwanted = clone.querySelectorAll(
          "script, style, nav, video, iframe, [class*='video'], [class*='Video'], [class*='player'], [class*='Player']"
        );
        unwanted.forEach((el) => {
          el.remove();
        });

        return clone.innerHTML;
      }
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

    // Look for download links
    const downloadLinks = document.querySelectorAll(
      'a[download], a[href*=".pdf"], a[href*=".doc"], a[href*=".xls"], a[href*=".ppt"], a[href*=".zip"]'
    );

    const seen = new Set<string>();

    for (const link of Array.from(downloadLinks)) {
      const anchor = link as HTMLAnchorElement;
      const url = anchor.href;

      if (!url || seen.has(url)) continue;
      seen.add(url);

      // Get filename
      let name = anchor.download || anchor.textContent?.trim() || "";
      if (!name) {
        const urlParts = url.split("/");
        name = urlParts[urlParts.length - 1]?.split("?")[0] ?? "attachment";
      }

      // Determine type from extension
      const ext = name.split(".").pop()?.toLowerCase() ?? "";
      let type = "file";
      if (["pdf"].includes(ext)) type = "pdf";
      else if (["doc", "docx"].includes(ext)) type = "document";
      else if (["xls", "xlsx"].includes(ext)) type = "spreadsheet";
      else if (["ppt", "pptx"].includes(ext)) type = "presentation";
      else if (["zip", "rar", "7z"].includes(ext)) type = "archive";

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
 * Extracts complete lesson content using DOM-based extraction.
 * Note: LearningSuite uses persisted GraphQL queries, so we can't make arbitrary API calls.
 */
export async function extractLearningSuitePostContent(
  page: Page,
  lessonUrl: string,
  _tenantId: string,
  _courseId: string,
  lessonId: string
): Promise<LearningSuitePostContent | null> {
  // Navigate to lesson page
  await page.goto(lessonUrl, { timeout: 30000 });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2000);

  // Extract content from DOM (GraphQL API uses persisted queries only)
  const video = await extractVideoFromPage(page);
  const htmlContent = await extractHtmlContent(page);
  const attachments = await extractAttachmentsFromPage(page);

  // Get title from page
  const title = await page.evaluate(() => {
    const titleEl = document.querySelector("h1, [class*='title'], [class*='Title']");
    return titleEl?.textContent?.trim() ?? document.title.split(" - ")[0] ?? "Untitled";
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
