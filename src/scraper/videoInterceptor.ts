/**
 * Browser-based video URL interception - requires Playwright.
 * Excluded from coverage via vitest.config.ts.
 */
import type { CDPSession, Page } from "playwright";
import {
  selectVimeoHlsUrl,
  selectVimeoProgressiveUrl,
  type VimeoHlsConfig,
  type VimeoProgressiveRendition,
} from "../downloader/shared/index.js";

// ============================================================================
// Type definitions for external browser APIs
// ============================================================================

/** Vimeo player configuration embedded in the page */
interface VimeoPlayerConfig {
  request?: {
    files?: {
      hls?: VimeoHlsConfig;
      progressive?: VimeoProgressiveRendition[];
    };
  };
}

/** Vimeo-related window properties */
interface VimeoWindow {
  playerConfig?: VimeoPlayerConfig;
  vimeo?: { config?: VimeoPlayerConfig };
  __vimeo_player__?: { config?: VimeoPlayerConfig };
}

/** Loom video asset URLs */
interface LoomAssetUrls {
  hls_url?: string;
}

/** Loom video data */
interface LoomVideo {
  asset_urls?: LoomAssetUrls;
}

/** Loom SSR state embedded in the page */
interface LoomSSRState {
  video?: LoomVideo;
}

/** Loom-related window properties */
interface LoomWindow {
  __LOOM_SSR_STATE__?: LoomSSRState;
}

/** Next.js data for Loom pages */
interface LoomNextData {
  props?: {
    pageProps?: {
      video?: LoomVideo;
    };
  };
}

/**
 * Captures Vimeo video URL by extracting it from the running player.
 * The key insight: the video is ALREADY playing in the iframe - we just need to get the URL.
 */
export async function captureVimeoConfig(
  page: Page,
  _videoId: string,
  timeoutMs = 20000
): Promise<{ hlsUrl: string | null; progressiveUrl: string | null; error?: string }> {
  try {
    // Step 1: Make sure we have a Vimeo iframe or video wrapper
    // Skool wraps videos in a VideoPlayerWrapper - click it to ensure video loads
    const videoWrapper = await page.$(
      '[class*="VideoPlayerWrapper"], [class*="video-wrapper"], [class*="VideoPlayer"]'
    );
    if (videoWrapper) {
      await videoWrapper.click().catch(() => {});
    }

    // Step 2: Wait for Vimeo iframe to appear
    let vimeoFrame = null;
    const startTime = Date.now();

    while (!vimeoFrame && Date.now() - startTime < timeoutMs) {
      // Try to find the iframe
      const iframe = await page.$('iframe[src*="vimeo.com"], iframe[src*="player.vimeo"]');
      if (iframe) {
        vimeoFrame = await iframe.contentFrame();
        if (vimeoFrame) break;
      }
      await page.waitForTimeout(500);
    }

    if (!vimeoFrame) {
      return { hlsUrl: null, progressiveUrl: null, error: "Vimeo iframe not found after waiting" };
    }

    // Step 3: Mute the video before playing (we don't want audio!)
    await vimeoFrame
      .evaluate(() => {
        const video = document.querySelector("video");
        if (video) {
          video.muted = true;
          video.volume = 0;
        }
      })
      .catch(() => {});

    // Step 4: Click play button in the iframe to start video
    try {
      // Multiple selectors for Vimeo's play button
      await vimeoFrame
        .click(
          '.vp-controls button, .play-icon, [aria-label="Play"], .vp-big-play-button, button',
          {
            timeout: 2000,
          }
        )
        .catch(() => {});
    } catch {
      // Video might auto-play
    }

    // Ensure video stays muted
    await vimeoFrame
      .evaluate(() => {
        const video = document.querySelector("video");
        if (video) {
          video.muted = true;
          video.volume = 0;
        }
      })
      .catch(() => {});

    // Step 4: Wait for video to actually start playing and get the URL
    let hlsUrl: string | null = null;
    let progressiveUrl: string | null = null;

    const extractionStart = Date.now();
    while (!hlsUrl && !progressiveUrl && Date.now() - extractionStart < timeoutMs - 5000) {
      const urls = await vimeoFrame.evaluate(() => {
        const result = {
          hlsUrl: null as string | null,
          progressiveUrl: null as string | null,
          hlsConfig: null as VimeoHlsConfig | null,
          progressiveRenditions: null as VimeoProgressiveRendition[] | null,
          debug: [] as string[],
        };

        // Method 1: Get URL directly from video element
        const video = document.querySelector("video");
        if (video) {
          result.debug.push(`Video element found, src length: ${video.src?.length ?? 0}`);

          // Check currentSrc (what's actually playing)
          if (video.currentSrc) {
            result.debug.push(`currentSrc: ${video.currentSrc.substring(0, 80)}`);
            if (video.currentSrc.includes(".m3u8")) {
              result.hlsUrl = video.currentSrc;
            } else if (video.currentSrc.includes(".mp4")) {
              result.progressiveUrl = video.currentSrc;
            }
          }

          // Also check src attribute
          if (!result.hlsUrl && !result.progressiveUrl && video.src) {
            if (video.src.includes(".m3u8")) {
              result.hlsUrl = video.src;
            } else if (video.src.includes(".mp4")) {
              result.progressiveUrl = video.src;
            }
          }
        }

        // Method 2: Check source elements
        if (!result.hlsUrl && !result.progressiveUrl) {
          const sources = document.querySelectorAll("video source");
          result.debug.push(`Found ${sources.length} source elements`);
          for (const source of Array.from(sources)) {
            const src = (source as HTMLSourceElement).src;
            if (src?.includes(".m3u8")) {
              result.hlsUrl = src;
              break;
            } else if (src?.includes(".mp4") && !result.progressiveUrl) {
              result.progressiveUrl = src;
            }
          }
        }

        // Method 3: Extract from Vimeo's internal player state
        if (!result.hlsUrl && !result.progressiveUrl) {
          try {
            const win = window as unknown as VimeoWindow;

            // Try various Vimeo internal variables
            const configPaths = [
              win.playerConfig?.request?.files,
              win.vimeo?.config?.request?.files,
              win.__vimeo_player__?.config?.request?.files,
            ];

            for (const files of configPaths) {
              if (!files) continue;

              if (files.hls?.cdns) result.hlsConfig = files.hls;
              if (files.progressive?.length) result.progressiveRenditions = files.progressive;
              if (result.hlsConfig || result.progressiveRenditions) break;
            }
          } catch (e) {
            result.debug.push(
              `Config extraction error: ${e instanceof Error ? e.message : String(e)}`
            );
          }
        }

        // Method 4: Network request URLs might be in DOM attributes
        if (!result.hlsUrl && !result.progressiveUrl) {
          const allElements = document.querySelectorAll("*");
          for (const el of Array.from(allElements)) {
            for (const attr of Array.from(el.attributes)) {
              if (attr.value.includes("vimeocdn.com") && attr.value.includes(".m3u8")) {
                result.hlsUrl = /https:\/\/[^\s"']+\.m3u8[^\s"']*/.exec(attr.value)?.[0] ?? null;
                if (result.hlsUrl) {
                  result.debug.push("Found HLS in element attribute");
                  break;
                }
              }
            }
            if (result.hlsUrl) break;
          }
        }

        return result;
      });

      hlsUrl = urls.hlsUrl ?? selectVimeoHlsUrl(urls.hlsConfig);
      progressiveUrl = urls.progressiveUrl ?? selectVimeoProgressiveUrl(urls.progressiveRenditions);

      if (!hlsUrl && !progressiveUrl) {
        // Wait and try again
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    if (hlsUrl || progressiveUrl) {
      return { hlsUrl, progressiveUrl };
    }

    return {
      hlsUrl: null,
      progressiveUrl: null,
      error: "Could not extract video URL from Vimeo player",
    };
  } catch (error) {
    return {
      hlsUrl: null,
      progressiveUrl: null,
      error: `Vimeo extraction failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Captures Loom HLS URL by navigating directly to the embed page.
 * This works better than CDP because we can intercept all requests on that page.
 */
export async function captureLoomHls(
  page: Page,
  videoId: string,
  timeoutMs = 15000
): Promise<{ hlsUrl: string | null; error?: string }> {
  let capturedUrl: string | null = null;
  const originalUrl = page.url();
  let client: CDPSession | null = null;
  let responseHandler: ((event: { response: { url: string } }) => void) | null = null;
  let finishCapture = () => {};

  try {
    // Use CDP to intercept network responses
    const activeClient = await page.context().newCDPSession(page);
    client = activeClient;
    await activeClient.send("Network.enable");

    // Match HLS playlists from Loom's CDN
    // Prefer master playlist (playlist.m3u8) over media playlists (mediaplaylist-*.m3u8)
    const masterPattern = /luna\.loom\.com.*\/playlist\.m3u8/;
    const anyHlsPattern = /luna\.loom\.com.*\.m3u8/;

    // Set up listener before navigation
    const responsePromise = new Promise<void>((resolve) => {
      let captureTimeout: ReturnType<typeof setTimeout> | null = null;
      let fallbackTimeout: ReturnType<typeof setTimeout> | null = null;
      let settled = false;
      let hasMasterPlaylist = false;

      finishCapture = () => {
        if (settled) return;
        settled = true;
        if (captureTimeout) clearTimeout(captureTimeout);
        if (fallbackTimeout) clearTimeout(fallbackTimeout);
        resolve();
      };

      captureTimeout = setTimeout(() => {
        finishCapture();
      }, timeoutMs);

      responseHandler = (event) => {
        const url = event.response.url;

        // Always prefer master playlist
        if (masterPattern.test(url)) {
          capturedUrl = url;
          hasMasterPlaylist = true;
          finishCapture();
        } else if (!hasMasterPlaylist && anyHlsPattern.test(url)) {
          // Keep a short window open for the preferred master playlist.
          capturedUrl = url;
          fallbackTimeout ??= setTimeout(
            () => {
              finishCapture();
            },
            Math.min(1000, timeoutMs)
          );
        }
      };

      activeClient.on("Network.responseReceived", responseHandler);
    });

    // Navigate directly to Loom embed with autoplay (muted)
    const embedUrl = `https://www.loom.com/embed/${videoId}?autoplay=1`;
    await page.goto(embedUrl, { waitUntil: "domcontentloaded", timeout: 10000 });

    // Mute the video immediately
    await page
      .evaluate(() => {
        const video = document.querySelector("video");
        if (video) {
          video.muted = true;
          video.volume = 0;
        }
      })
      .catch(() => {});

    // Try to click play button if video doesn't autoplay
    try {
      const playButton = page
        .locator(
          '[data-testid="play-button"], .PlayButton, [aria-label="Play"], button[class*="play"]'
        )
        .first();
      await playButton.waitFor({ state: "visible", timeout: 2000 }).catch(() => {});
      if (await playButton.isVisible().catch(() => false)) {
        // Mute again before clicking play
        await page
          .evaluate(() => {
            const video = document.querySelector("video");
            if (video) {
              video.muted = true;
              video.volume = 0;
            }
          })
          .catch(() => {});
        await playButton.click();
      }
    } catch {
      // No play button or click failed
    }

    // Ensure video stays muted after play
    await page
      .evaluate(() => {
        const video = document.querySelector("video");
        if (video) {
          video.muted = true;
          video.volume = 0;
        }
      })
      .catch(() => {});

    // Wait for HLS to be captured
    await responsePromise;

    // Also try to extract from page JS if not found via network
    if (!capturedUrl) {
      const jsUrl = await page.evaluate(() => {
        const win = window as unknown as LoomWindow;

        // Check __LOOM_SSR_STATE__
        if (win.__LOOM_SSR_STATE__?.video?.asset_urls?.hls_url) {
          return win.__LOOM_SSR_STATE__.video.asset_urls.hls_url;
        }

        // Check for Next.js data
        const nextData = document.getElementById("__NEXT_DATA__");
        if (nextData?.textContent) {
          try {
            const data = JSON.parse(nextData.textContent) as LoomNextData;
            const hlsUrl = data?.props?.pageProps?.video?.asset_urls?.hls_url;
            if (hlsUrl) return hlsUrl;

            // Try regex match in full data
            const videoData = /hls_url['":\s]+['"]([^'"]+)['"]/.exec(JSON.stringify(data));
            if (videoData?.[1]) return videoData[1];
          } catch {
            /* ignore parse errors */
          }
        }

        // Scan scripts for HLS URL
        const scripts = Array.from(document.querySelectorAll("script"));
        for (const script of scripts) {
          const match = /https:\/\/luna\.loom\.com[^"'\s]+\.m3u8[^"'\s]*/.exec(
            script.textContent ?? ""
          );
          if (match) return match[0];
        }

        return null;
      });

      if (jsUrl) {
        capturedUrl = jsUrl;
      }
    }
  } catch {
    // Error during capture
  } finally {
    finishCapture();
    if (client && responseHandler) {
      client.off("Network.responseReceived", responseHandler);
    }
    await client?.detach().catch(() => {});
  }

  // Navigate back to original page
  try {
    await page.goto(originalUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
  } catch {
    // Failed to navigate back
  }

  return capturedUrl ? { hlsUrl: capturedUrl } : { hlsUrl: null, error: "HLS URL not captured" };
}

// ============================================================================
// Encrypted HLS Segment Capture
// ============================================================================

/**
 * Options for capturing encrypted HLS segments.
 */
export interface CaptureEncryptedHLSOptions {
  /**
   * Pattern to match CDN segment URLs (e.g., /b-cdn\.net.*\.ts/)
   * Must match URLs that contain the video segments with their auth tokens.
   */
  cdnPattern: RegExp;

  /**
   * Approximate duration of each segment in seconds.
   * Used to calculate seek positions. Default: 4 (Bunny CDN default)
   */
  segmentDuration?: number;

  /**
   * Interval between seek positions in seconds.
   * Should be ~3x segmentDuration to ensure all segments are captured.
   * Default: 12
   */
  seekInterval?: number;

  /** Delay after each seek while the player requests segments. Default: 800 ms. */
  seekDelay?: number;

  /**
   * Maximum time to wait for video duration to be available (ms).
   * Default: 10000
   */
  durationTimeout?: number;
}

/**
 * Result of encrypted HLS segment capture.
 */
export interface CaptureEncryptedHLSResult {
  /** Array of segment URLs with their individual auth tokens */
  segmentUrls: string[];

  /** Video duration in seconds (if detected) */
  videoDuration: number | null;

  /** Error message if capture failed */
  error?: string;
}

/**
 * Captures encrypted HLS segment URLs by intercepting network requests during video playback.
 *
 * ## Why This Is Needed
 *
 * Some platforms (like LearningSuite with Bunny CDN) use encrypted HLS playlists:
 * - The playlist API returns encrypted data, not standard `#EXTM3U`
 * - JavaScript decrypts it client-side
 * - Each `.ts` segment has a unique, short-lived auth token
 * - HLS players load segments on-demand, not all at once
 *
 * ## How It Works
 *
 * 1. Sets up request interception to capture segment URLs
 * 2. Clicks play to start video playback
 * 3. Gets video duration from the player
 * 4. Seeks through the entire video timeline to trigger all segment requests
 * 5. Returns all captured segment URLs sorted by segment number
 *
 * ## Usage
 *
 * ```typescript
 * import { createSegmentsUrl } from "../downloader/shared/index.js";
 *
 * const result = await captureEncryptedHLSSegments(page, {
 *   cdnPattern: /b-cdn\.net.*\.ts.*token=/,
 * });
 *
 * if (result.segmentUrls.length > 0) {
 *   const segmentsUrl = createSegmentsUrl(result.segmentUrls);
 *   // Pass to downloadHLSVideo or downloadHLSSegments
 * }
 * ```
 *
 * @param page Playwright page with video player loaded
 * @param options Configuration for segment capture
 * @returns Captured segment URLs and metadata
 */
export async function captureEncryptedHLSSegments(
  page: Page,
  options: CaptureEncryptedHLSOptions
): Promise<CaptureEncryptedHLSResult> {
  const {
    cdnPattern,
    segmentDuration = 4,
    seekInterval = segmentDuration * 3,
    seekDelay = 800,
    durationTimeout = 10000,
  } = options;

  const segmentUrls: string[] = [];

  // Set up request interception
  const requestHandler = (request: { url: () => string }) => {
    const url = request.url();
    if (cdnPattern.test(url) && !segmentUrls.includes(url)) {
      segmentUrls.push(url);
    }
  };

  page.on("request", requestHandler);

  try {
    // Try to start video playback
    const playSelectors = [
      '[aria-label*="play" i]',
      '[class*="play" i]',
      'button[class*="Play"]',
      '[data-testid*="play"]',
      "video",
    ];

    for (const selector of playSelectors) {
      try {
        const element = page.locator(selector).first();
        if (await element.isVisible({ timeout: 1000 }).catch(() => false)) {
          await element.click({ timeout: 2000 });
          break;
        }
      } catch {
        // Try next selector
      }
    }

    // Playwright locators pierce open Shadow DOM, unlike document.querySelector.
    const videoLocator = page.locator("video").first();

    // Get video duration
    let videoDuration = 0;
    const startTime = Date.now();

    while (videoDuration === 0 && Date.now() - startTime < durationTimeout) {
      try {
        if ((await videoLocator.count()) > 0) {
          videoDuration = await videoLocator.evaluate(
            (video) => (video as HTMLVideoElement).duration || 0
          );
        }
      } catch {
        videoDuration = 0;
      }

      if (videoDuration === 0 || !Number.isFinite(videoDuration)) {
        videoDuration = 0;
        await page.waitForTimeout(500);
      }
    }

    if (videoDuration === 0) {
      return {
        segmentUrls: [...new Set(segmentUrls)],
        videoDuration: null,
        error: "Could not determine video duration",
      };
    }

    // Generate seek positions throughout the video
    const seekPositions: number[] = [];
    for (let t = 0; t < videoDuration; t += seekInterval) {
      seekPositions.push(t);
    }
    // Always include near the end
    seekPositions.push(Math.max(0, videoDuration - 2));
    seekPositions.push(Math.max(0, videoDuration - 0.5));

    // Seek through video to trigger all segment requests
    for (const seekTime of seekPositions) {
      try {
        await videoLocator.evaluate((video, time) => {
          (video as HTMLVideoElement).currentTime = time;
        }, seekTime);
      } catch {
        break;
      }
      await page.waitForTimeout(seekDelay);
    }

    // Seek back to start
    await videoLocator
      .evaluate((video) => {
        (video as HTMLVideoElement).currentTime = 0;
      })
      .catch(() => {});

    // Give time for final segment requests
    await page.waitForTimeout(1500);

    // Sort segments by number (e.g., video0.ts, video1.ts, ...)
    const sortedSegments = [...new Set(segmentUrls)].sort((a, b) => {
      const numA = parseInt(/video(\d+)\.ts/.exec(a)?.[1] ?? "0", 10);
      const numB = parseInt(/video(\d+)\.ts/.exec(b)?.[1] ?? "0", 10);
      return numA - numB;
    });

    return {
      segmentUrls: sortedSegments,
      videoDuration,
    };
  } finally {
    page.off("request", requestHandler);
  }
}
