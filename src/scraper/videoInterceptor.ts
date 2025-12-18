import type { Page } from "playwright";

/**
 * Captures Vimeo config by navigating directly to the player page.
 * This works better for domain-restricted videos because we can intercept all requests.
 */
export async function captureVimeoConfig(
  page: Page,
  videoId: string,
  timeoutMs = 15000
): Promise<{ hlsUrl: string | null; progressiveUrl: string | null; error?: string }> {
  let hlsUrl: string | null = null;
  let progressiveUrl: string | null = null;
  const originalUrl = page.url();
  
  // Extract hash from iframe if available
  let unlistedHash: string | null = null;
  try {
    unlistedHash = await page.evaluate((vid) => {
      const iframe = document.querySelector(`iframe[src*="vimeo.com"][src*="${vid}"]`);
      if (iframe) {
        const src = (iframe as HTMLIFrameElement).src;
        const hashMatch = src.match(/[?&]h=([a-f0-9]+)/);
        return hashMatch?.[1] ?? null;
      }
      return null;
    }, videoId);
  } catch {
    // Failed to extract hash
  }

  try {
    // Use CDP to intercept network responses
    const client = await page.context().newCDPSession(page);
    await client.send('Network.enable');

    const configPattern = /player\.vimeo\.com\/video\/\d+\/config/;
    
    // Set up listener before navigation
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
            // Error getting response body
          }
        }
      });
    });

    // Navigate directly to Vimeo player with autoplay
    const hashParam = unlistedHash ? `?h=${unlistedHash}&autoplay=1` : '?autoplay=1';
    const embedUrl = `https://player.vimeo.com/video/${videoId}${hashParam}`;
    
    // Set referer to Skool to pass domain checks
    await page.goto(embedUrl, { 
      waitUntil: 'domcontentloaded', 
      timeout: 10000,
      referer: originalUrl,
    });
    
    // Wait for config to be captured
    await responsePromise;
    
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

  return (hlsUrl || progressiveUrl)
    ? { hlsUrl, progressiveUrl }
    : { hlsUrl: null, progressiveUrl: null, error: "Config not captured - video may be DRM protected" };
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

