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
 * Checks if there's a video preview/thumbnail that needs to be clicked to load the video.
 */
async function tryClickVideoPreview(page: Page): Promise<boolean> {
  // First, try Skool's specific styled-components pattern for video players
  // These have classes like "styled__VideoPlayerWrapper-sc-xxx" and "styled__PlaybackButton-sc-xxx"

  // Strategy 0: Direct click on Skool's VideoPlayerWrapper or PlaybackButton
  const skoolClicked = await page.evaluate(() => {
    // Find the playback button directly
    const playbackButton = document.querySelector('[class*="PlaybackButton"]');
    if (playbackButton && playbackButton instanceof HTMLElement) {
      const rect = playbackButton.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        playbackButton.click();
        return { clicked: true, selector: 'PlaybackButton' };
      }
    }

    // Or try clicking the video player wrapper
    const videoWrapper = document.querySelector('[class*="VideoPlayerWrapper"]');
    if (videoWrapper && videoWrapper instanceof HTMLElement) {
      const rect = videoWrapper.getBoundingClientRect();
      if (rect.width > 200 && rect.height > 100) {
        videoWrapper.click();
        return { clicked: true, selector: 'VideoPlayerWrapper' };
      }
    }

    // Try styled-components video patterns
    const styledVideo = document.querySelector('[class*="styled__Video"]');
    if (styledVideo && styledVideo instanceof HTMLElement) {
      styledVideo.click();
      return { clicked: true, selector: 'styled__Video' };
    }

    return { clicked: false };
  });

  if (skoolClicked.clicked) {
    // Wait for iframe to appear after click
    try {
      await page.waitForSelector('iframe[src*="loom.com"], iframe[src*="vimeo"], iframe[src*="youtube"], video', {
        timeout: 5000,
      });
    } catch {
      // Timeout is fine, we'll check for video anyway
    }
    // Extra wait for iframe content to load
    await page.waitForTimeout(1000);
    return true;
  }

  // Strategy 1: Look for elements that contain "loom" in href or data attributes
  const loomClicked = await page.evaluate(() => {
    // Find any anchor or element with loom URL
    const loomLink = document.querySelector('a[href*="loom.com"]');
    if (loomLink && loomLink instanceof HTMLElement) {
      // Try to find a parent container that might be the video preview
      let container = loomLink.parentElement;
      for (let i = 0; i < 5 && container; i++) {
        const rect = container.getBoundingClientRect();
        if (rect.width > 300 && rect.height > 150) {
          container.click();
          return true;
        }
        container = container.parentElement;
      }
      loomLink.click();
      return true;
    }

    // Look for elements with loom-related classes or data
    const loomElements = Array.from(document.querySelectorAll(
      '[class*="loom"], [data-loom], [data-video-provider="loom"]'
    ));
    for (const el of loomElements) {
      if (el instanceof HTMLElement) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 100 && rect.height > 50) {
          el.click();
          return true;
        }
      }
    }

    return false;
  });

  if (loomClicked) {
    await page.waitForTimeout(2500);
    return true;
  }

  // Strategy 2: Look for play button overlays on large elements
  const playClicked = await page.evaluate(() => {
    // Find all elements that look like play buttons (including styled-components patterns)
    const playButtons = Array.from(document.querySelectorAll(
      '[class*="play" i], [class*="Play"], [class*="Playback"], svg[class*="play" i], [aria-label*="play" i]'
    ));

    for (const btn of playButtons) {
      if (btn instanceof HTMLElement || btn instanceof SVGElement) {
        const rect = btn.getBoundingClientRect();
        // Play buttons are usually visible and reasonably sized
        if (rect.width > 20 && rect.height > 20 && rect.top > 0 && rect.left > 0) {
          // Check if this is inside a large container (video preview)
          let parent = btn.parentElement;
          for (let i = 0; i < 5 && parent; i++) {
            const parentRect = parent.getBoundingClientRect();
            if (parentRect.width > 300 && parentRect.height > 150) {
              // This looks like a video container - click the play button
              if (btn instanceof HTMLElement) {
                btn.click();
              } else {
                // For SVG, try to click the parent
                (parent as HTMLElement).click();
              }
              return true;
            }
            parent = parent.parentElement;
          }
        }
      }
    }
    return false;
  });

  if (playClicked) {
    await page.waitForTimeout(2500);
    return true;
  }

  // Strategy 3: Look for large clickable images/thumbnails
  const thumbnailClicked = await page.evaluate(() => {
    // Find large images that might be video thumbnails
    const images = Array.from(document.querySelectorAll('img'));

    for (const img of images) {
      const rect = img.getBoundingClientRect();
      // Video thumbnails are typically 16:9 or similar aspect ratio
      if (rect.width > 400 && rect.height > 200) {
        // Check if image has a sibling or parent with play icon
        const parent = img.parentElement;
        if (parent) {
          const hasPLay = parent.querySelector('[class*="play" i], svg');
          if (hasPLay || parent.className.toLowerCase().includes('video')) {
            (parent as HTMLElement).click();
            return true;
          }
        }
      }
    }

    return false;
  });

  if (thumbnailClicked) {
    await page.waitForTimeout(2500);
    return true;
  }

  // Strategy 4: Common patterns for video preview overlays
  const previewSelectors = [
    // Skool-specific patterns
    '[class*="VideoWrapper"]',
    '[class*="video-wrapper"]',
    '[class*="video-container"]',
    '[class*="VideoContainer"]',
    '[class*="player-wrapper"]',
    '[class*="embed-wrapper"]',
    // Generic patterns
    '[class*="video-preview"]',
    '[class*="VideoPreview"]',
    '[class*="video-thumbnail"]',
    '[class*="poster"]',
    // Data attribute patterns
    '[data-video-id]',
    '[data-video-url]',
    '[data-embed]',
  ];

  for (const selector of previewSelectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        const isVisible = await element.isVisible();
        if (isVisible) {
          const box = await element.boundingBox();
          if (box && box.width > 200 && box.height > 100) {
            await element.click();
            await page.waitForTimeout(2500);
            return true;
          }
        }
      }
    } catch {
      // Selector not found or not clickable, try next
    }
  }

  return false;
}

/**
 * Extracts the video URL from the current lesson page.
 * Supports Loom, Vimeo, YouTube, Wistia, and native video.
 * 
 * For Vimeo: Prefers iframe src (has auth params) over __NEXT_DATA__ URL.
 * For others: Uses __NEXT_DATA__ first, then falls back to DOM inspection.
 */
export async function extractVideoUrl(
  page: Page
): Promise<{ url: string | null; type: LessonContent["videoType"] }> {
  // First: Check for iframe with full URL (includes auth params for Vimeo)
  const iframeVideo = await extractVideoFromIframe(page);
  
  // If it's Vimeo, prefer iframe URL as it has the auth hash
  if (iframeVideo.url && iframeVideo.type === "vimeo") {
    return iframeVideo;
  }

  // Try extracting from __NEXT_DATA__ (Skool embeds video URLs here)
  const nextDataVideo = await extractVideoFromNextData(page);
  if (nextDataVideo.url) {
    // For Vimeo, check if iframe has additional params we're missing
    if (nextDataVideo.type === "vimeo" && iframeVideo.url) {
      return iframeVideo; // iframe has the full URL with hash
    }
    return nextDataVideo;
  }

  // Check for already loaded video in DOM
  let videoInfo = await findVideoInPage(page);

  // If no video found, try clicking preview to trigger lazy load
  if (!videoInfo.url) {
    const clicked = await tryClickVideoPreview(page);
    if (clicked) {
      // Re-check for video after clicking
      videoInfo = await findVideoInPage(page);
    }
  }

  return videoInfo;
}

/**
 * Extracts video URL directly from iframe src attribute.
 * This captures the full URL including auth parameters.
 */
async function extractVideoFromIframe(
  page: Page
): Promise<{ url: string | null; type: LessonContent["videoType"] }> {
  return page.evaluate(() => {
    // Check for Vimeo iframe (prioritize this for auth params)
    const vimeoIframe = document.querySelector('iframe[src*="vimeo.com"]');
    if (vimeoIframe) {
      const src = (vimeoIframe as HTMLIFrameElement).src;
      if (src) {
        return { url: src, type: "vimeo" as const };
      }
    }

    // Check for Loom iframe  
    const loomIframe = document.querySelector('iframe[src*="loom.com"]');
    if (loomIframe) {
      const src = (loomIframe as HTMLIFrameElement).src;
      if (src) {
        return { url: src, type: "loom" as const };
      }
    }

    // Check for YouTube iframe
    const ytIframe = document.querySelector('iframe[src*="youtube.com"], iframe[src*="youtu.be"]');
    if (ytIframe) {
      const src = (ytIframe as HTMLIFrameElement).src;
      if (src) {
        return { url: src, type: "youtube" as const };
      }
    }

    return { url: null, type: null };
  });
}

/**
 * Extracts video URL from Skool's __NEXT_DATA__ JSON.
 * This is the most reliable method as Skool stores video metadata here.
 *
 * IMPORTANT: __NEXT_DATA__ is only updated on full page loads, not SPA navigation.
 * Our sync uses page.goto() which triggers full loads, so this is fine.
 * We also verify the module ID matches the current URL to detect stale data.
 */
async function extractVideoFromNextData(
  page: Page
): Promise<{ url: string | null; type: LessonContent["videoType"] }> {
  const videoInfo = await page.evaluate(() => {
    const nextDataScript = document.querySelector('#__NEXT_DATA__');
    if (!nextDataScript?.textContent) {
      return { url: null, type: null };
    }

    try {
      const data = JSON.parse(nextDataScript.textContent);

      // Get the selected module ID from __NEXT_DATA__
      const selectedModule = data?.props?.pageProps?.selectedModule;
      if (!selectedModule) {
        return { url: null, type: null };
      }

      // Verify this matches the current URL (detect stale __NEXT_DATA__ from SPA navigation)
      const urlParams = new URLSearchParams(window.location.search);
      const urlModuleId = urlParams.get('md');
      if (urlModuleId && urlModuleId !== selectedModule) {
        // __NEXT_DATA__ is stale (SPA navigation happened), don't trust it
        return { url: null, type: null };
      }

      // Find the module in the course children
      const courseData = data?.props?.pageProps?.course;
      const children = courseData?.children ?? [];

      for (const child of children) {
        if (child?.course?.id === selectedModule) {
          const metadata = child.course.metadata;
          const videoLink = metadata?.videoLink;

          if (videoLink) {
            // Determine video type from URL
            if (videoLink.includes('loom.com')) {
              // Convert share URL to embed URL if needed
              const embedUrl = videoLink.replace('/share/', '/embed/').split('?')[0];
              return { url: embedUrl, type: "loom" as const };
            }
            if (videoLink.includes('vimeo.com')) {
              return { url: videoLink, type: "vimeo" as const };
            }
            if (videoLink.includes('youtube.com') || videoLink.includes('youtu.be')) {
              return { url: videoLink, type: "youtube" as const };
            }
            if (videoLink.includes('wistia')) {
              return { url: videoLink, type: "wistia" as const };
            }
            // Unknown but has video link
            return { url: videoLink, type: "unknown" as const };
          }
        }
      }
    } catch {
      // JSON parse failed
    }

    return { url: null, type: null };
  });

  return videoInfo;
}

/**
 * Finds video URL in the current page state.
 */
async function findVideoInPage(
  page: Page
): Promise<{ url: string | null; type: LessonContent["videoType"] }> {
  const videoInfo = await page.evaluate(() => {
    // Check for Loom iframe (most common on Skool)
    const loomIframe = document.querySelector('iframe[src*="loom.com"]');
    if (loomIframe) {
      return { url: (loomIframe as HTMLIFrameElement).src, type: "loom" as const };
    }

    // Check for Loom embed link (sometimes used instead of iframe)
    const loomLinks = Array.from(document.querySelectorAll('a[href*="loom.com"]'));
    for (const link of loomLinks) {
      const href = (link as HTMLAnchorElement).href;
      if (href.includes("/share/") || href.includes("/embed/")) {
        // Convert share URL to embed URL
        const embedUrl = href.replace("/share/", "/embed/");
        return { url: embedUrl, type: "loom" as const };
      }
    }

    // Check for Loom data attributes
    const loomEmbed = document.querySelector('[data-loom-id]');
    if (loomEmbed) {
      const loomId = loomEmbed.getAttribute("data-loom-id");
      if (loomId) {
        return { url: `https://www.loom.com/embed/${loomId}`, type: "loom" as const };
      }
    }

    // Check for Loom URLs in any element's attributes or content
    const allElements = Array.from(document.querySelectorAll('*'));
    for (const el of allElements) {
      // Check data attributes
      const attrs = Array.from(el.attributes);
      for (const attr of attrs) {
        if (attr.value.includes('loom.com/share/') || attr.value.includes('loom.com/embed/')) {
          const match = attr.value.match(/loom\.com\/(share|embed)\/([a-f0-9]+)/);
          if (match?.[2]) {
            return { url: `https://www.loom.com/embed/${match[2]}`, type: "loom" as const };
          }
        }
      }
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

    // Last resort: search page HTML for loom URLs
    const pageHtml = document.documentElement.outerHTML;
    const loomMatch = pageHtml.match(/loom\.com\/(share|embed)\/([a-f0-9]{32})/);
    if (loomMatch?.[2]) {
      return { url: `https://www.loom.com/embed/${loomMatch[2]}`, type: "loom" as const };
    }

    // Try to find explicit Loom video IDs in script tags
    const scripts = Array.from(document.querySelectorAll('script'));
    for (const script of scripts) {
      const content = script.textContent ?? '';

      // Look for explicit loom URL patterns in scripts
      const loomUrlMatch = content.match(/loom\.com\/(share|embed)\/([a-f0-9]{32})/);
      if (loomUrlMatch?.[2]) {
        return { url: `https://www.loom.com/embed/${loomUrlMatch[2]}`, type: "loom" as const };
      }

      // Look for loom video ID near "loom" keyword
      const loomContextMatch = content.match(/["']loom["'][^}]*["']([a-f0-9]{32})["']/i);
      if (loomContextMatch?.[1]) {
        return { url: `https://www.loom.com/embed/${loomContextMatch[1]}`, type: "loom" as const };
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
