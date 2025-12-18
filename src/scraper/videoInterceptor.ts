import type { Page, Route } from "playwright";

export interface CapturedVideoUrl {
  hlsUrl: string | null;
  progressiveUrl: string | null;
  configUrl: string | null;
  iframeSrc: string | null;
  type: "loom" | "vimeo" | "youtube" | "wistia" | "unknown";
}

/**
 * Captures video streaming URLs by intercepting network requests.
 * This works by monitoring requests when the video player loads on the page.
 */
export async function captureVideoUrls(
  page: Page,
  videoType: "loom" | "vimeo" | "youtube" | "wistia" | "unknown",
  timeoutMs = 8000
): Promise<CapturedVideoUrl> {
  const result: CapturedVideoUrl = {
    hlsUrl: null,
    progressiveUrl: null,
    configUrl: null,
    iframeSrc: null,
    type: videoType,
  };

  // Patterns to match for each video type
  const patterns: Record<string, RegExp[]> = {
    loom: [
      /luna\.loom\.com.*playlist\.m3u8/i,  // Loom HLS
      /loom\.com.*\/config/i,               // Loom config
    ],
    vimeo: [
      /vimeocdn\.com.*\.m3u8/i,            // Vimeo HLS
      /skyfire\.vimeocdn\.com.*master\.json/i, // Vimeo master
      /player\.vimeo\.com\/video\/\d+\/config/i, // Vimeo config
      /vod-progressive.*\.mp4/i,           // Vimeo progressive
    ],
    youtube: [
      /googlevideo\.com.*\.m3u8/i,
    ],
    wistia: [
      /wistia\.net.*\.m3u8/i,
      /wistia\.com.*\.bin/i,
    ],
    unknown: [],
  };

  const targetPatterns = patterns[videoType] ?? [];
  if (targetPatterns.length === 0) {
    return result;
  }

  return new Promise((resolve) => {
    const capturedUrls: string[] = [];
    let resolved = false;

    // Handler for intercepted requests
    const handleRoute = async (route: Route) => {
      const url = route.request().url();

      // Check if URL matches any of our patterns
      for (const pattern of targetPatterns) {
        if (pattern.test(url)) {
          capturedUrls.push(url);

          // Categorize the URL
          if (url.includes(".m3u8") || url.includes("playlist")) {
            if (!result.hlsUrl) {
              result.hlsUrl = url;
            }
          } else if (url.includes(".mp4") || url.includes("progressive")) {
            if (!result.progressiveUrl) {
              result.progressiveUrl = url;
            }
          } else if (url.includes("config") || url.includes("master.json")) {
            if (!result.configUrl) {
              result.configUrl = url;
            }
          }

          break;
        }
      }

      // Continue the request
      await route.continue();
    };

    // Set up interception for all requests
    page.route("**/*", handleRoute).catch(() => {});

    // Try to trigger video load by clicking play button or waiting
    triggerVideoLoad(page).catch(() => {});

    // Wait for timeout or until we have what we need
    const checkInterval = setInterval(() => {
      if (result.hlsUrl || result.progressiveUrl) {
        cleanup();
      }
    }, 500);

    const timeout = setTimeout(() => {
      cleanup();
    }, timeoutMs);

    function cleanup() {
      if (resolved) return;
      resolved = true;

      clearInterval(checkInterval);
      clearTimeout(timeout);

      // Remove route handler
      page.unroute("**/*", handleRoute).catch(() => {});

      resolve(result);
    }
  });
}

/**
 * Tries to trigger video loading by interacting with the player.
 */
async function triggerVideoLoad(page: Page): Promise<void> {
  // Try clicking on video player elements
  const playSelectors = [
    '[class*="PlayButton"]',
    '[class*="PlaybackButton"]',
    '[class*="play-button"]',
    '[class*="VideoPlayer"] button',
    '[class*="CoverImage"]',
    '[aria-label*="Play"]',
    'video',
    'iframe[src*="loom"]',
    'iframe[src*="vimeo"]',
  ];

  for (const selector of playSelectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        const box = await element.boundingBox();
        if (box && box.width > 50 && box.height > 50) {
          await element.click({ timeout: 1000 }).catch(() => {});
          await page.waitForTimeout(500);
          break;
        }
      }
    } catch {
      // Continue trying other selectors
    }
  }
}

/**
 * Extracts video config by navigating to embed page and capturing config response.
 */
export async function captureVimeoConfig(
  page: Page,
  videoId: string,
  timeoutMs = 10000
): Promise<{ hlsUrl: string | null; progressiveUrl: string | null; error?: string }> {
  let hlsUrl: string | null = null;
  let progressiveUrl: string | null = null;

  const configPattern = /player\.vimeo\.com\/video\/\d+\/config/;

  // Listen for config response
  const responseHandler = async (response: { url: () => string; json: () => Promise<any> }) => {
    const url = response.url();
    if (configPattern.test(url)) {
      try {
        const body = await response.json();

        // Extract URLs from config
        const hlsCdns = body?.request?.files?.hls?.cdns;
        if (hlsCdns) {
          const cdnKeys = Object.keys(hlsCdns);
          for (const cdn of ["akfire_interconnect_quic", "akamai_live", "fastly_skyfire", ...cdnKeys]) {
            if (hlsCdns[cdn]?.url) {
              hlsUrl = hlsCdns[cdn].url;
              break;
            }
          }
        }

        const progressive = body?.request?.files?.progressive;
        if (progressive && Array.isArray(progressive) && progressive.length > 0) {
          const sorted = [...progressive].sort((a: {height?: number}, b: {height?: number}) =>
            (b.height ?? 0) - (a.height ?? 0)
          );
          progressiveUrl = sorted[0]?.url ?? null;
        }
      } catch {
        // JSON parse failed
      }
    }
  };

  page.on('response', responseHandler);

  try {
    // Navigate to Vimeo embed page with autoplay
    const embedUrl = `https://player.vimeo.com/video/${videoId}?autoplay=1&muted=1`;
    await page.goto(embedUrl, { timeout: timeoutMs, waitUntil: "networkidle" });

    // Check if captured
    if (hlsUrl || progressiveUrl) {
      return { hlsUrl, progressiveUrl };
    }

    // Wait a bit and check again
    await page.waitForTimeout(2000);
    if (hlsUrl || progressiveUrl) {
      return { hlsUrl, progressiveUrl };
    }

    // Try clicking play if autoplay didn't work
    try {
      await page.click('.play, [aria-label="Play"], button', { timeout: 1000 });
      await page.waitForTimeout(2000);
    } catch {
      // No play button
    }

  } catch {
    // Navigation might fail
  } finally {
    page.off('response', responseHandler);
  }

  if (hlsUrl || progressiveUrl) {
    return { hlsUrl, progressiveUrl };
  } else {
    return { hlsUrl: null, progressiveUrl: null, error: "Config not captured from embed page" };
  }
}

/**
 * Captures Loom HLS URL by navigating to embed page and listening for responses.
 */
export async function captureLoomHls(
  page: Page,
  videoId: string,
  timeoutMs = 10000
): Promise<{ hlsUrl: string | null; error?: string }> {
  let capturedUrl: string | null = null;

  const hlsPattern = /luna\.loom\.com.*playlist\.m3u8/;

  // Listen for responses (more reliable than route interception)
  const responseHandler = (response: { url: () => string }) => {
    const url = response.url();
    if (hlsPattern.test(url)) {
      capturedUrl = url;
    }
  };

  page.on('response', responseHandler);

  try {
    // Navigate to Loom embed page with autoplay
    const embedUrl = `https://www.loom.com/embed/${videoId}?autoplay=1&hide_owner=true&hide_share=true&hide_title=true`;
    await page.goto(embedUrl, { timeout: timeoutMs, waitUntil: "networkidle" });
    
    // Check if we already captured it
    if (capturedUrl) {
      return { hlsUrl: capturedUrl };
    }

    // Wait a bit more and check
    await page.waitForTimeout(2000);
    if (capturedUrl) {
      return { hlsUrl: capturedUrl };
    }
    
    // Try clicking play button if autoplay didn't work
    try {
      const playSelectors = [
        '[data-testid="play-button"]',
        '.PlayButton', 
        '[aria-label="Play"]',
        'button[class*="play"]',
        '[class*="PlaybackButton"]',
      ];
      
      for (const selector of playSelectors) {
        const btn = await page.$(selector);
        if (btn) {
          const isVisible = await btn.isVisible();
          if (isVisible) {
            await btn.click();
            // Wait for HLS request after click
            await page.waitForTimeout(3000);
            if (capturedUrl) break;
          }
        }
      }
    } catch {
      // No play button found
    }

    // Try extracting from page JavaScript as fallback
    if (!capturedUrl) {
      const jsUrl = await page.evaluate(() => {
        // Check for Loom's internal state
        const win = window as any;
        if (win.__LOOM_SSR_STATE__?.video?.asset_urls?.hls_url) {
          return win.__LOOM_SSR_STATE__.video.asset_urls.hls_url;
        }
        // Check for any m3u8 URL in script tags
        const scripts = Array.from(document.querySelectorAll('script'));
        for (const script of scripts) {
          const match = script.textContent?.match(/https:\/\/luna\.loom\.com[^"'\s]+playlist\.m3u8[^"'\s]*/);
          if (match) return match[0];
        }
        return null;
      });
      if (jsUrl) {
        capturedUrl = jsUrl;
      }
    }

  } catch (error) {
    // Navigation might timeout
  } finally {
    // Remove listener
    page.off('response', responseHandler);
  }
  
  if (capturedUrl) {
    return { hlsUrl: capturedUrl };
  } else {
    return { hlsUrl: null, error: "HLS URL not captured from embed page" };
  }
}

