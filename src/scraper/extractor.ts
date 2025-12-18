import type { Page } from "playwright";
import TurndownService from "turndown";

export interface LessonContent {
  title: string;
  videoUrl: string | null;
  videoType: "loom" | "vimeo" | "youtube" | "wistia" | "native" | "unknown" | null;
  htmlContent: string;
  markdownContent: string;
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
 * Supports Loom, Vimeo, YouTube, Wistia, and native video.
 */
export async function extractVideoUrl(
  page: Page
): Promise<{ url: string | null; type: LessonContent["videoType"] }> {
  const videoInfo = await page.evaluate(() => {
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
 */
export async function extractTextContent(page: Page): Promise<{ html: string; markdown: string }> {
  const html = await page.evaluate(() => {
    // Skool lesson content is typically in a styled div below the video
    // Look for common content container patterns
    const contentSelectors = [
      '[class*="LessonContent"]',
      '[class*="PostContent"]',
      '[class*="ContentWrapper"]',
      '[class*="content-body"]',
      "article",
      '[class*="prose"]',
    ];

    for (const selector of contentSelectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent && element.textContent.trim().length > 50) {
        // Clone to avoid modifying the actual page
        const clone = element.cloneNode(true) as HTMLElement;

        // Remove unwanted elements
        const unwanted = clone.querySelectorAll(
          "script, style, nav, [class*='video'], [class*='Video'], iframe, [class*='player'], [class*='Player']"
        );
        unwanted.forEach((el) => el.remove());

        return clone.innerHTML;
      }
    }

    // Fallback: Try to find the main content area by structure
    // Skool typically has: Header -> Video -> Content
    const mainContent = document.querySelector("main, [class*='Main']");
    if (mainContent) {
      const clone = mainContent.cloneNode(true) as HTMLElement;

      // Remove video player and navigation
      const unwanted = clone.querySelectorAll(
        "script, style, nav, header, [class*='video'], [class*='Video'], iframe, [class*='Sidebar'], [class*='sidebar']"
      );
      unwanted.forEach((el) => el.remove());

      // Get remaining text content
      const textContent = clone.innerHTML;
      if (textContent.trim().length > 100) {
        return textContent;
      }
    }

    return "";
  });

  const markdown = html ? turndown.turndown(html) : "";

  return { html, markdown };
}

/**
 * Extracts all content from a lesson page.
 */
export async function extractLessonContent(page: Page, lessonUrl: string): Promise<LessonContent> {
  const currentUrl = page.url();

  if (currentUrl !== lessonUrl) {
    await page.goto(lessonUrl, { timeout: 30000 });
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);
  }

  const title = await page.title();
  const { url: videoUrl, type: videoType } = await extractVideoUrl(page);
  const { html: htmlContent, markdown: markdownContent } = await extractTextContent(page);

  // Clean up title: "1. Lesson Name - Module Name · Course Name" -> "1. Lesson Name"
  const cleanTitle = title.split(" - ")[0]?.trim() ?? title;

  return {
    title: cleanTitle,
    videoUrl,
    videoType,
    htmlContent,
    markdownContent,
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
  videoType: string | null
): string {
  const lines = [`# ${title}`, ""];

  if (videoUrl) {
    const videoLabel = videoType ? `${videoType.charAt(0).toUpperCase()}${videoType.slice(1)}` : "Video";
    lines.push(`> 📺 ${videoLabel}: ${videoUrl}`, "");
  }

  if (content.trim()) {
    lines.push(content);
  }

  // Clean up excessive newlines
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
