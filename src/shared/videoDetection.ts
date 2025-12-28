/**
 * Unified video embed detection utilities.
 * Detects embedded videos (Vimeo, Loom, YouTube, Wistia, HLS) from page DOM.
 */
import type { Page } from "playwright";

/**
 * Supported video provider types.
 */
export type VideoProviderType =
  | "vimeo"
  | "loom"
  | "youtube"
  | "wistia"
  | "hls"
  | "native"
  | "unknown";

/**
 * Detected video information.
 */
export interface DetectedVideo {
  type: VideoProviderType;
  url: string;
  /** For Wistia, the video ID */
  id?: string;
}

/**
 * Iframe selector patterns for each provider.
 */
const IFRAME_SELECTORS = {
  vimeo: 'iframe[src*="vimeo.com"], iframe[src*="player.vimeo"]',
  loom: 'iframe[src*="loom.com"]',
  youtube:
    'iframe[src*="youtube.com"], iframe[src*="youtube-nocookie.com"], iframe[src*="youtu.be"]',
} as const;

/**
 * Detects a Vimeo embed iframe on the page.
 */
export async function detectVimeoEmbed(page: Page): Promise<string | null> {
  return page.evaluate((selector) => {
    const iframe = document.querySelector(selector);
    return iframe ? (iframe as HTMLIFrameElement).src : null;
  }, IFRAME_SELECTORS.vimeo);
}

/**
 * Detects a Loom embed iframe on the page.
 */
export async function detectLoomEmbed(page: Page): Promise<string | null> {
  return page.evaluate((selector) => {
    const iframe = document.querySelector(selector);
    return iframe ? (iframe as HTMLIFrameElement).src : null;
  }, IFRAME_SELECTORS.loom);
}

/**
 * Detects a YouTube embed iframe on the page.
 */
export async function detectYouTubeEmbed(page: Page): Promise<string | null> {
  return page.evaluate((selector) => {
    const iframe = document.querySelector(selector);
    return iframe ? (iframe as HTMLIFrameElement).src : null;
  }, IFRAME_SELECTORS.youtube);
}

/**
 * Detects a Wistia embed on the page.
 */
export async function detectWistiaEmbed(page: Page): Promise<{ id: string } | null> {
  return page.evaluate(() => {
    const wistiaEmbed = document.querySelector('[class*="wistia"]');
    if (wistiaEmbed) {
      const match = /wistia_embed wistia_async_(\w+)/.exec(wistiaEmbed.className);
      if (match?.[1]) {
        return { id: match[1] };
      }
    }
    return null;
  });
}

/**
 * Detects HLS video sources on the page.
 */
export async function detectHlsVideo(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    // Check video elements for HLS sources
    const videoElements = Array.from(document.querySelectorAll("video"));
    for (const video of videoElements) {
      const src = video.currentSrc ?? video.src;
      if (src?.includes(".m3u8")) {
        return src;
      }
    }

    // Check source elements
    const sources = Array.from(
      document.querySelectorAll('source[type*="m3u8"], source[src*=".m3u8"]')
    );
    for (const source of sources) {
      const src = (source as HTMLSourceElement).src;
      if (src) return src;
    }

    return null;
  });
}

/**
 * Detects native video elements (MP4, WebM) on the page.
 */
export async function detectNativeVideo(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const video = document.querySelector("video");
    if (video) {
      const src = video.currentSrc ?? video.src;
      if (src && !src.includes(".m3u8")) {
        return src;
      }
    }
    return null;
  });
}

/**
 * Detects any video embed on the page.
 * Checks providers in order: HLS, Vimeo, Loom, YouTube, Wistia, Native.
 *
 * @param page - Playwright page to search
 * @returns Detected video info or null if no video found
 *
 * @example
 * ```typescript
 * const video = await detectEmbeddedVideo(page);
 * if (video?.type === "vimeo") {
 *   await downloadVimeoVideo(video.url, outputPath);
 * }
 * ```
 */
export async function detectEmbeddedVideo(page: Page): Promise<DetectedVideo | null> {
  // Check for HLS first (highest priority for native players)
  const hlsUrl = await detectHlsVideo(page);
  if (hlsUrl) {
    return { type: "hls", url: hlsUrl };
  }

  // Check for Vimeo
  const vimeoUrl = await detectVimeoEmbed(page);
  if (vimeoUrl) {
    return { type: "vimeo", url: vimeoUrl };
  }

  // Check for Loom
  const loomUrl = await detectLoomEmbed(page);
  if (loomUrl) {
    return { type: "loom", url: loomUrl };
  }

  // Check for YouTube
  const youtubeUrl = await detectYouTubeEmbed(page);
  if (youtubeUrl) {
    return { type: "youtube", url: youtubeUrl };
  }

  // Check for Wistia
  const wistiaInfo = await detectWistiaEmbed(page);
  if (wistiaInfo) {
    return {
      type: "wistia",
      url: `https://fast.wistia.net/embed/iframe/${wistiaInfo.id}`,
      id: wistiaInfo.id,
    };
  }

  // Check for native video
  const nativeUrl = await detectNativeVideo(page);
  if (nativeUrl) {
    return { type: "native", url: nativeUrl };
  }

  return null;
}

/**
 * Checks if a page has any video embed selector present (fast check without extraction).
 */
export async function hasVideoEmbed(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const selectors = [
      'iframe[src*="loom.com"]',
      'iframe[src*="vimeo"]',
      'iframe[src*="youtube"]',
      '[class*="wistia"]',
      "video",
    ];
    return selectors.some((sel) => document.querySelector(sel) !== null);
  });
}
