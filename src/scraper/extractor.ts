import type { Page } from "playwright";
import TurndownService from "turndown";

export interface LessonContent {
  title: string;
  videoUrl: string | null;
  videoType: "loom" | "vimeo" | "youtube" | "wistia" | "native" | "unknown" | null;
  htmlContent: string;
  markdownContent: string;
  isLocked: boolean;
  updatedAt: string | null;
}

// Initialize Turndown for HTML to Markdown conversion
const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

// Custom rule to handle images
turndown.addRule("images", {
  filter: "img",
  replacement: (_content, node) => {
    const img = node as HTMLImageElement;
    const alt = img.alt || "";
    const src = img.src || "";
    return `![${alt}](${src})`;
  },
});

// Custom rule to preserve links
turndown.addRule("links", {
  filter: "a",
  replacement: (content, node) => {
    const anchor = node as HTMLAnchorElement;
    const href = anchor.href || "";
    if (!href || href === content) {
      return content;
    }
    return `[${content}](${href})`;
  },
});

/**
 * Extracts the video URL from the current lesson page.
 */
export async function extractVideoUrl(
  page: Page
): Promise<{ url: string | null; type: LessonContent["videoType"] }> {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const videoInfo = await page.evaluate(() => {
    /* eslint-disable @typescript-eslint/no-unnecessary-condition */
    // Check for Loom iframe (most common on Skool)
    const loomIframe = document.querySelector('iframe[src*="loom.com"]');
    if (loomIframe) {
      return { url: (loomIframe as HTMLIFrameElement).src, type: "loom" as const };
    }

    // Check for Vimeo iframe
    const vimeoIframe = document.querySelector('iframe[src*="vimeo.com"]');
    if (vimeoIframe) {
      return { url: (vimeoIframe as HTMLIFrameElement).src, type: "vimeo" as const };
    }

    // Check for YouTube iframe
    const youtubeIframe = document.querySelector(
      'iframe[src*="youtube.com"], iframe[src*="youtu.be"]'
    );
    if (youtubeIframe) {
      return { url: (youtubeIframe as HTMLIFrameElement).src, type: "youtube" as const };
    }

    // Check for Wistia
    const wistiaVideo = document.querySelector('[class*="wistia"]');
    if (wistiaVideo) {
      const wistiaId = wistiaVideo.className.match(/wistia_embed wistia_async_(\w+)/);
      if (wistiaId?.[1]) {
        return {
          url: `https://fast.wistia.net/embed/medias/${wistiaId[1]}`,
          type: "wistia" as const,
        };
      }
    }

    // Check for HTML5 video
    const videoElement = document.querySelector("video");
    if (videoElement) {
      const source = videoElement.querySelector("source");
      const src = source?.src ?? videoElement.src;
      if (src) {
        return { url: src, type: "native" as const };
      }
    }

    // Check for any iframe that might be a video player
    const iframes = Array.from(document.querySelectorAll("iframe"));
    for (const iframe of iframes) {
      const src = iframe.src;
      if (
        src &&
        !src.includes("stripe.com") &&
        (src.includes("embed") || src.includes("player") || src.includes("video"))
      ) {
        return { url: src, type: "unknown" as const };
      }
    }

    return { url: null, type: null };
  });

  return videoInfo;
}

/**
 * Extracts the text content from the lesson page.
 * Specifically targets the editor content area and removes sidebar/navigation.
 */
export async function extractTextContent(page: Page): Promise<{ html: string; markdown: string }> {
  const html = await page.evaluate(() => {
    /* eslint-disable @typescript-eslint/no-unnecessary-condition */
    // Skool uses styled-components. The actual content is in EditorContentWrapper
    // Try specific Skool selectors first
    const skoolSelectors = [
      '[class*="EditorContentWrapper"]', // Main content area
      '[class*="PostBody"]',
      '[class*="LessonBody"]',
    ];

    for (const selector of skoolSelectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent && element.textContent.trim().length > 20) {
        return element.innerHTML;
      }
    }

    // Fallback: Find the course content area and extract only the text part
    const courseContent = document.querySelector('[class*="CourseContent"]');
    if (courseContent) {
      const clone = courseContent.cloneNode(true) as HTMLElement;

      // Remove all navigation, sidebar, video elements
      const unwantedSelectors = [
        '[class*="Sidebar"]',
        '[class*="sidebar"]',
        '[class*="Navigation"]',
        '[class*="nav"]',
        '[class*="ChildrenLink"]', // Lesson navigation links
        '[class*="VideoPlayer"]',
        '[class*="video"]',
        'iframe',
        'script',
        'style',
        '[class*="Progress"]',
        '[class*="Header"]',
      ];

      for (const selector of unwantedSelectors) {
        clone.querySelectorAll(selector).forEach((el) => el.remove());
      }

      // Find the actual text content div (usually after the video)
      const textDivs = Array.from(clone.querySelectorAll('div[class*="Editor"], div[class*="Content"]'));
      for (const div of textDivs) {
        const text = div.textContent?.trim() ?? "";
        if (text.length > 50 && !text.includes("Herzlich Willkommen")) {
          return div.innerHTML;
        }
      }

      // Last resort: return cleaned content
      const finalContent = clone.innerHTML;
      if (finalContent.trim().length > 50) {
        return finalContent;
      }
    }

    return "";
  });

  // Clean up the markdown
  let markdown = html ? turndown.turndown(html) : "";

  // Remove navigation artifacts that might have slipped through
  // Pattern: Links that look like lesson navigation (numbered list items with just links)
  markdown = markdown
    .replace(/\[\n*\d+\.\s*[^\]]+\n*\]\([^)]+\/classroom\/[^)]+\)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { html, markdown };
}

/**
 * Checks if the current page shows a "locked" or "no access" message.
 */
async function checkIfLocked(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    /* eslint-disable @typescript-eslint/no-unnecessary-condition */
    const pageText = document.body.textContent?.toLowerCase() ?? "";

    const lockPatterns = [
      "you don't have access",
      "you do not have access",
      "unlock this",
      "no access",
      "nicht freigeschaltet",
      "kein zugriff",
      "zugang erforderlich",
    ];

    return lockPatterns.some((pattern) => pageText.includes(pattern));
  });
}

/**
 * Extracts the updatedAt timestamp from the page's JSON data.
 */
async function extractUpdatedAt(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    /* eslint-disable @typescript-eslint/no-unnecessary-condition */
    const scripts = Array.from(document.querySelectorAll("script"));
    for (const script of scripts) {
      const content = script.textContent ?? "";
      // Look for updatedAt in the current lesson's data
      const match = content.match(/"updatedAt":"([^"]+)"/);
      if (match?.[1]) {
        return match[1];
      }
    }
    return null;
  });
}

/**
 * Extracts all content from a lesson page.
 */
export async function extractLessonContent(page: Page, lessonUrl: string): Promise<LessonContent> {
  const currentUrl = page.url();

  if (currentUrl !== lessonUrl) {
    await page.goto(lessonUrl, { timeout: 30000, waitUntil: "domcontentloaded" });
    // Reduced wait time - just enough for React to render
    await page.waitForTimeout(500);
  }

  // Check if content is locked
  const isLocked = await checkIfLocked(page);

  if (isLocked) {
    const title = await page.title();
    const cleanTitle = title.split(" - ")[0]?.trim() ?? title;
    return {
      title: cleanTitle,
      videoUrl: null,
      videoType: null,
      htmlContent: "",
      markdownContent: "",
      isLocked: true,
      updatedAt: null,
    };
  }

  const [title, videoInfo, textContent, updatedAt] = await Promise.all([
    page.title(),
    extractVideoUrl(page),
    extractTextContent(page),
    extractUpdatedAt(page),
  ]);

  const cleanTitle = title.split(" - ")[0]?.trim() ?? title;

  return {
    title: cleanTitle,
    videoUrl: videoInfo.url,
    videoType: videoInfo.type,
    htmlContent: textContent.html,
    markdownContent: textContent.markdown,
    isLocked: false,
    updatedAt,
  };
}

/**
 * Extracts the Loom video ID from an embed URL.
 */
export function extractLoomVideoId(embedUrl: string): string | null {
  const match = embedUrl.match(/loom\.com\/embed\/([a-f0-9]+)/);
  return match?.[1] ?? null;
}

/**
 * Cleans and formats the markdown content.
 */
export function formatMarkdown(
  title: string,
  content: string,
  videoUrl: string | null,
  videoType: string | null,
  updatedAt: string | null = null
): string {
  const lines = [`# ${title}`, ""];

  // Add metadata block
  const metaLines: string[] = [];
  if (updatedAt) {
    const date = new Date(updatedAt);
    metaLines.push(`Last updated: ${date.toLocaleDateString("de-DE")}`);
  }
  if (videoUrl) {
    const videoLabel = videoType
      ? `${videoType.charAt(0).toUpperCase()}${videoType.slice(1)}`
      : "Video";
    metaLines.push(`📺 ${videoLabel}: ${videoUrl}`);
  }

  if (metaLines.length > 0) {
    lines.push(`> ${metaLines.join("  \n> ")}`, "");
  }

  if (content.trim()) {
    lines.push(content);
  }

  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
