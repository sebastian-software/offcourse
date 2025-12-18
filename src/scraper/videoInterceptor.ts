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
 * Captures Vimeo config from the current page using CDP network interception.
 * This works for domain-restricted videos because we stay on the Skool page.
 */
export async function captureVimeoConfig(
  page: Page,
  videoId: string,
  timeoutMs = 15000
): Promise<{ hlsUrl: string | null; progressiveUrl: string | null; error?: string }> {
  let hlsUrl: string | null = null;
  let progressiveUrl: string | null = null;

  try {
    // Use CDP to intercept all network responses (including from iframes)
    const client = await page.context().newCDPSession(page);
    await client.send('Network.enable');

    const configPattern = new RegExp(`player\\.vimeo\\.com/video/${videoId}/config`);
    
    // Listen for network responses
    const responsePromise = new Promise<void>((resolve) => {
      const timeout = setTimeout(() => resolve(), timeoutMs);
      
      client.on('Network.responseReceived', async (event) => {
        const url = event.response.url;
        
        if (configPattern.test(url)) {
          try {
            // Get the response body
            const { body } = await client.send('Network.getResponseBody', {
              requestId: event.requestId,
            });
            
            const config = JSON.parse(body);
            
            // Extract HLS URL
            const hlsCdns = config?.request?.files?.hls?.cdns;
            if (hlsCdns) {
              const cdnKeys = Object.keys(hlsCdns);
              for (const cdn of ["akfire_interconnect_quic", "akamai_live", "fastly_skyfire", ...cdnKeys]) {
                if (hlsCdns[cdn]?.url) {
                  hlsUrl = hlsCdns[cdn].url;
                  break;
                }
              }
            }

            // Extract progressive URL
            const progressive = config?.request?.files?.progressive;
            if (progressive && Array.isArray(progressive) && progressive.length > 0) {
              const sorted = [...progressive].sort((a: {height?: number}, b: {height?: number}) =>
                (b.height ?? 0) - (a.height ?? 0)
              );
              progressiveUrl = sorted[0]?.url ?? null;
            }
            
            clearTimeout(timeout);
            resolve();
          } catch {
            // Response body not available or parse failed
          }
        }
      });
    });

    // Trigger video load by clicking on player or scrolling to iframe
    await triggerVideoLoad(page);
    
    // Wait for config to be captured
    await responsePromise;
    
    await client.detach();

  } catch (error) {
    // CDP might not be available
  }

  if (hlsUrl || progressiveUrl) {
    return { hlsUrl, progressiveUrl };
  } else {
    return { hlsUrl: null, progressiveUrl: null, error: "Config not captured - video may be DRM protected" };
  }
}

/**
 * Captures Loom HLS URL using CDP network interception.
 * Works by staying on the current page and capturing iframe requests.
 */
export async function captureLoomHls(
  page: Page,
  _videoId: string,
  timeoutMs = 15000
): Promise<{ hlsUrl: string | null; error?: string }> {
  let capturedUrl: string | null = null;

  try {
    // Use CDP to intercept all network responses (including from iframes)
    const client = await page.context().newCDPSession(page);
    await client.send('Network.enable');

    const hlsPattern = /luna\.loom\.com.*playlist\.m3u8/;
    
    // Listen for network responses
    const responsePromise = new Promise<void>((resolve) => {
      const timeout = setTimeout(() => resolve(), timeoutMs);
      
      client.on('Network.responseReceived', (event) => {
        const url = event.response.url;
        
        if (hlsPattern.test(url)) {
          capturedUrl = url;
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    // Trigger video load
    await triggerVideoLoad(page);
    
    // Wait for HLS to be captured
    await responsePromise;
    
    await client.detach();

  } catch {
    // CDP might not be available, try fallback
  }

  // Fallback: try extracting from page JavaScript
  if (!capturedUrl) {
    try {
      const jsUrl = await page.evaluate(() => {
        // Check for Loom's internal state in any iframe
        const iframes = Array.from(document.querySelectorAll('iframe[src*="loom"]'));
        for (const iframe of iframes) {
          try {
            const win = (iframe as HTMLIFrameElement).contentWindow as any;
            if (win?.__LOOM_SSR_STATE__?.video?.asset_urls?.hls_url) {
              return win.__LOOM_SSR_STATE__.video.asset_urls.hls_url;
            }
          } catch {
            // Cross-origin access denied
          }
        }
        
        // Check main window
        const mainWin = window as any;
        if (mainWin.__LOOM_SSR_STATE__?.video?.asset_urls?.hls_url) {
          return mainWin.__LOOM_SSR_STATE__.video.asset_urls.hls_url;
        }
        
        return null;
      });
      if (jsUrl) {
        capturedUrl = jsUrl;
      }
    } catch {
      // Evaluation failed
    }
  }
  
  if (capturedUrl) {
    return { hlsUrl: capturedUrl };
  } else {
    return { hlsUrl: null, error: "HLS URL not captured" };
  }
}

