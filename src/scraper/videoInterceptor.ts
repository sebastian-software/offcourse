import type { Page } from "playwright";

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
    const videoWrapper = await page.$('[class*="VideoPlayerWrapper"], [class*="video-wrapper"], [class*="VideoPlayer"]');
    if (videoWrapper) {
      await videoWrapper.click().catch(() => {});
      await page.waitForTimeout(1000);
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

    // Step 3: Click play button in the iframe to start video
    try {
      // Multiple selectors for Vimeo's play button
      await vimeoFrame.click('.vp-controls button, .play-icon, [aria-label="Play"], .vp-big-play-button, button', { 
        timeout: 2000 
      }).catch(() => {});
    } catch {
      // Video might auto-play
    }
    
    // Step 4: Wait for video to actually start playing and get the URL
    let hlsUrl: string | null = null;
    let progressiveUrl: string | null = null;
    
    const extractionStart = Date.now();
    while (!hlsUrl && !progressiveUrl && Date.now() - extractionStart < timeoutMs - 5000) {
      
      const urls = await vimeoFrame.evaluate(() => {
        const result = { 
          hlsUrl: null as string | null, 
          progressiveUrl: null as string | null,
          debug: [] as string[]
        };

        // Method 1: Get URL directly from video element
        const video = document.querySelector('video');
        if (video) {
          result.debug.push(`Video element found, src length: ${video.src?.length ?? 0}`);
          
          // Check currentSrc (what's actually playing)
          if (video.currentSrc) {
            result.debug.push(`currentSrc: ${video.currentSrc.substring(0, 80)}`);
            if (video.currentSrc.includes('.m3u8')) {
              result.hlsUrl = video.currentSrc;
            } else if (video.currentSrc.includes('.mp4')) {
              result.progressiveUrl = video.currentSrc;
            }
          }
          
          // Also check src attribute
          if (!result.hlsUrl && !result.progressiveUrl && video.src) {
            if (video.src.includes('.m3u8')) {
              result.hlsUrl = video.src;
            } else if (video.src.includes('.mp4')) {
              result.progressiveUrl = video.src;
            }
          }
        }

        // Method 2: Check source elements
        if (!result.hlsUrl && !result.progressiveUrl) {
          const sources = document.querySelectorAll('video source');
          result.debug.push(`Found ${sources.length} source elements`);
          for (const source of Array.from(sources)) {
            const src = (source as HTMLSourceElement).src;
            if (src?.includes('.m3u8')) {
              result.hlsUrl = src;
              break;
            } else if (src?.includes('.mp4') && !result.progressiveUrl) {
              result.progressiveUrl = src;
            }
          }
        }

        // Method 3: Extract from Vimeo's internal player state
        if (!result.hlsUrl && !result.progressiveUrl) {
          try {
            const win = window as any;
            
            // Try various Vimeo internal variables
            const configPaths = [
              win.playerConfig?.request?.files,
              win.vimeo?.config?.request?.files,
              win.__vimeo_player__?.config?.request?.files,
            ];
            
            for (const files of configPaths) {
              if (!files) continue;
              
              // HLS
              if (files.hls?.cdns) {
                const cdns = files.hls.cdns;
                for (const cdn of Object.keys(cdns)) {
                  if (cdns[cdn]?.url) {
                    result.hlsUrl = cdns[cdn].url;
                    result.debug.push(`Found HLS in playerConfig.${cdn}`);
                    break;
                  }
                }
              }
              
              // Progressive MP4
              if (!result.progressiveUrl && files.progressive?.length > 0) {
                const sorted = [...files.progressive].sort((a: any, b: any) => 
                  (b.height ?? 0) - (a.height ?? 0)
                );
                result.progressiveUrl = sorted[0]?.url ?? null;
                if (result.progressiveUrl) {
                  result.debug.push('Found progressive in playerConfig');
                }
              }
              
              if (result.hlsUrl || result.progressiveUrl) break;
            }
          } catch (e) {
            result.debug.push(`Config extraction error: ${e}`);
          }
        }

        // Method 4: Network request URLs might be in DOM attributes
        if (!result.hlsUrl && !result.progressiveUrl) {
          const allElements = document.querySelectorAll('*');
          for (const el of Array.from(allElements)) {
            for (const attr of Array.from(el.attributes)) {
              if (attr.value.includes('vimeocdn.com') && attr.value.includes('.m3u8')) {
                result.hlsUrl = attr.value.match(/https:\/\/[^\s"']+\.m3u8[^\s"']*/)?.[0] ?? null;
                if (result.hlsUrl) {
                  result.debug.push('Found HLS in element attribute');
                  break;
                }
              }
            }
            if (result.hlsUrl) break;
          }
        }

        return result;
      });

      hlsUrl = urls.hlsUrl;
      progressiveUrl = urls.progressiveUrl;
      
      if (!hlsUrl && !progressiveUrl) {
        // Wait and try again
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    if (hlsUrl || progressiveUrl) {
      return { hlsUrl, progressiveUrl };
    }

    return { 
      hlsUrl: null, 
      progressiveUrl: null, 
      error: "Could not extract video URL from Vimeo player" 
    };

  } catch (error) {
    return {
      hlsUrl: null,
      progressiveUrl: null,
      error: `Vimeo extraction failed: ${error}`,
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

  try {
    // Use CDP to intercept network responses
    const client = await page.context().newCDPSession(page);
    await client.send('Network.enable');

    // Match HLS playlists from Loom's CDN
    const hlsPattern = /luna\.loom\.com.*(playlist\.m3u8|master\.m3u8|\.m3u8)/;

    // Set up listener before navigation
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

    // Navigate directly to Loom embed with autoplay
    const embedUrl = `https://www.loom.com/embed/${videoId}?autoplay=1`;
    await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });

    // Try to click play button if video doesn't autoplay
    try {
      await page.waitForTimeout(2000);
      const playButton = await page.$('[data-testid="play-button"], .PlayButton, [aria-label="Play"], button[class*="play"]');
      if (playButton) {
        await playButton.click();
      }
    } catch {
      // No play button or click failed
    }

    // Wait for HLS to be captured
    await responsePromise;

    // Also try to extract from page JS if not found via network
    if (!capturedUrl) {
      const jsUrl = await page.evaluate(() => {
        const win = window as any;

        // Check __LOOM_SSR_STATE__
        if (win.__LOOM_SSR_STATE__?.video?.asset_urls?.hls_url) {
          return win.__LOOM_SSR_STATE__.video.asset_urls.hls_url;
        }

        // Check for Next.js data
        const nextData = document.getElementById('__NEXT_DATA__');
        if (nextData?.textContent) {
          try {
            const data = JSON.parse(nextData.textContent);
            const hlsUrl = data?.props?.pageProps?.video?.asset_urls?.hls_url;
            if (hlsUrl) return hlsUrl;

            // Try regex match in full data
            const videoData = JSON.stringify(data).match(/hls_url['":\s]+['"]([^'"]+)['"]/);
            if (videoData?.[1]) return videoData[1];
          } catch { /* ignore parse errors */ }
        }

        // Scan scripts for HLS URL
        const scripts = Array.from(document.querySelectorAll('script'));
        for (const script of scripts) {
          const match = script.textContent?.match(/https:\/\/luna\.loom\.com[^"'\s]+\.m3u8[^"'\s]*/);
          if (match) return match[0];
        }

        return null;
      });

      if (jsUrl) {
        capturedUrl = jsUrl;
      }
    }

    await client.detach();

  } catch {
    // Error during capture
  }

  // Navigate back to original page
  try {
    await page.goto(originalUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
  } catch {
    // Failed to navigate back
  }

  return capturedUrl
    ? { hlsUrl: capturedUrl }
    : { hlsUrl: null, error: "HLS URL not captured" };
}

