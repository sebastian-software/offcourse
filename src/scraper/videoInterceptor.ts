import type { Page, Route } from "playwright";

export interface CapturedVideoUrl {
  hlsUrl: string | null;
  progressiveUrl: string | null;
  configUrl: string | null;
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
 * Extracts video config by intercepting the config request.
 * Returns the parsed config object if captured.
 */
export async function captureVimeoConfig(
  page: Page,
  videoId: string,
  timeoutMs = 5000
): Promise<{ hlsUrl: string | null; progressiveUrl: string | null; error?: string }> {
  return new Promise((resolve) => {
    let resolved = false;

    const configPattern = new RegExp(`player\\.vimeo\\.com/video/${videoId}/config`);

    const handleRoute = async (route: Route) => {
      const url = route.request().url();
      
      if (configPattern.test(url)) {
        try {
          // Fetch the response ourselves so we can read it
          const response = await route.fetch();
          const body = await response.json();
          
          // Extract URLs from config
          let hlsUrl: string | null = null;
          let progressiveUrl: string | null = null;

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

          // Fulfill the original request
          await route.fulfill({ response });

          if (!resolved) {
            resolved = true;
            page.unroute("**/*", handleRoute).catch(() => {});
            resolve({ hlsUrl, progressiveUrl });
          }
          return;
        } catch (error) {
          await route.continue();
        }
      }
      
      await route.continue();
    };

    page.route("**/*", handleRoute).catch(() => {});

    // Timeout
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        page.unroute("**/*", handleRoute).catch(() => {});
        resolve({ hlsUrl: null, progressiveUrl: null, error: "Config request not captured" });
      }
    }, timeoutMs);
  });
}

/**
 * Captures Loom HLS URL by intercepting embed page requests.
 */
export async function captureLoomHls(
  page: Page,
  videoId: string,
  timeoutMs = 5000
): Promise<{ hlsUrl: string | null; error?: string }> {
  return new Promise((resolve) => {
    let resolved = false;

    const hlsPattern = /luna\.loom\.com.*playlist\.m3u8/;

    const handleRoute = async (route: Route) => {
      const url = route.request().url();
      
      if (hlsPattern.test(url) && url.includes(videoId)) {
        if (!resolved) {
          resolved = true;
          page.unroute("**/*", handleRoute).catch(() => {});
          await route.continue();
          resolve({ hlsUrl: url });
          return;
        }
      }
      
      await route.continue();
    };

    page.route("**/*", handleRoute).catch(() => {});

    // Timeout
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        page.unroute("**/*", handleRoute).catch(() => {});
        resolve({ hlsUrl: null, error: "HLS URL not captured" });
      }
    }, timeoutMs);
  });
}

