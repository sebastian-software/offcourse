import type { Page } from "playwright";

export interface HighLevelVideoInfo {
  type: "hls" | "vimeo" | "loom" | "youtube" | "custom";
  url: string;
  masterPlaylistUrl?: string;
  qualities?: Array<{
    label: string;
    url: string;
    width?: number;
    height?: number;
  }>;
  duration?: number;
  thumbnailUrl?: string;
  token?: string;
}

export interface HighLevelPostContent {
  id: string;
  title: string;
  description: string | null;
  htmlContent: string | null;
  video: HighLevelVideoInfo | null;
  attachments: Array<{
    id: string;
    name: string;
    url: string;
    type: string;
    size?: number;
  }>;
  categoryId: string;
  productId: string;
}

/**
 * Extracts the Firebase auth token from the page.
 */
export async function getAuthToken(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const tokenKey = Object.keys(localStorage).find((k) => k.includes("firebase:authUser"));
    if (!tokenKey) return null;

    const tokenData = JSON.parse(localStorage.getItem(tokenKey) ?? "{}");
    return tokenData?.stsTokenManager?.accessToken ?? null;
  });
}

/**
 * Extracts video info from a HighLevel post page by intercepting network requests.
 */
export async function extractVideoFromPage(page: Page): Promise<HighLevelVideoInfo | null> {
  // First, check if there's an HLS video on the page
  const hlsUrl = await page.evaluate(() => {
    // Look for HLS master playlist URLs in the DOM
    const videoElements = Array.from(document.querySelectorAll("video"));
    for (const video of videoElements) {
      const src = video.currentSrc || video.src;
      if (src && src.includes(".m3u8")) {
        return src;
      }
    }

    // Check for plyr or other players
    const sources = Array.from(
      document.querySelectorAll('source[type*="m3u8"], source[src*=".m3u8"]')
    );
    for (const source of sources) {
      const src = (source as HTMLSourceElement).src;
      if (src) return src;
    }

    return null;
  });

  if (hlsUrl) {
    return {
      type: "hls",
      url: hlsUrl,
      masterPlaylistUrl: hlsUrl,
    };
  }

  // Check for Vimeo embed
  const vimeoUrl = await page.evaluate(() => {
    const iframe = document.querySelector('iframe[src*="vimeo.com"], iframe[src*="player.vimeo"]');
    if (iframe) {
      return (iframe as HTMLIFrameElement).src;
    }
    return null;
  });

  if (vimeoUrl) {
    return {
      type: "vimeo",
      url: vimeoUrl,
    };
  }

  // Check for Loom embed
  const loomUrl = await page.evaluate(() => {
    const iframe = document.querySelector('iframe[src*="loom.com"]');
    if (iframe) {
      return (iframe as HTMLIFrameElement).src;
    }
    return null;
  });

  if (loomUrl) {
    return {
      type: "loom",
      url: loomUrl,
    };
  }

  // Check for YouTube embed
  const youtubeUrl = await page.evaluate(() => {
    const iframe = document.querySelector(
      'iframe[src*="youtube.com"], iframe[src*="youtube-nocookie.com"], iframe[src*="youtu.be"]'
    );
    if (iframe) {
      return (iframe as HTMLIFrameElement).src;
    }
    return null;
  });

  if (youtubeUrl) {
    return {
      type: "youtube",
      url: youtubeUrl,
    };
  }

  return null;
}

/**
 * Extracts video info by intercepting network requests during page load.
 */
export async function interceptVideoRequests(
  page: Page,
  postUrl: string
): Promise<HighLevelVideoInfo | null> {
  const hlsUrls: string[] = [];
  const drmUrls: string[] = [];

  // Set up request interception
  const requestHandler = (request: { url: () => string }) => {
    const url = request.url();

    // Capture HLS master playlist requests
    if (url.includes(".m3u8") || url.includes("master.m3u8")) {
      hlsUrls.push(url);
    }

    // Capture DRM license requests
    if (url.includes("assets-drm/assets-license")) {
      drmUrls.push(url);
    }
  };

  page.on("request", requestHandler);

  // Navigate to the post page
  await page.goto(postUrl, { timeout: 30000 });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(3000);

  // Remove the handler
  page.off("request", requestHandler);

  // Get the HLS master playlist URL
  const masterPlaylistUrl = hlsUrls.find((url) => url.includes("master.m3u8"));

  if (masterPlaylistUrl) {
    return {
      type: "hls",
      url: masterPlaylistUrl,
      masterPlaylistUrl,
    };
  }

  // Fallback to DOM extraction
  return extractVideoFromPage(page);
}

/**
 * Fetches post details from the API.
 */
export async function fetchPostDetails(
  page: Page,
  locationId: string,
  postId: string
): Promise<{
  title: string;
  description: string | null;
  video: {
    assetId: string;
    url: string;
  } | null;
  materials: Array<{
    id: string;
    name: string;
    url: string;
    type: string;
  }>;
} | null> {
  return page.evaluate(
    async ({ locationId, postId }) => {
      try {
        const tokenKey = Object.keys(localStorage).find((k) => k.includes("firebase:authUser"));
        const tokenData = tokenKey ? JSON.parse(localStorage.getItem(tokenKey) ?? "{}") : null;
        const token = tokenData?.stsTokenManager?.accessToken;

        if (!token) {
          return null;
        }

        const res = await fetch(
          `https://services.leadconnectorhq.com/membership/locations/${locationId}/posts/${postId}?source=courses`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        if (!res.ok) {
          return null;
        }

        const data = await res.json();

        let video: { assetId: string; url: string } | null = null;

        if (data.post?.posterImage?.assetId) {
          video = {
            assetId: data.post.posterImage.assetId,
            url: data.post.posterImage.url ?? "",
          };
        }

        // Check for video in contentBlock
        if (data.post?.contentBlock) {
          for (const block of data.post.contentBlock) {
            if (block.type === "video" && block.assetId) {
              video = {
                assetId: block.assetId,
                url: block.url ?? "",
              };
              break;
            }
          }
        }

        const materials: Array<{
          id: string;
          name: string;
          url: string;
          type: string;
        }> = [];

        if (data.post?.materials && Array.isArray(data.post.materials)) {
          for (const material of data.post.materials) {
            materials.push({
              id: material.id ?? crypto.randomUUID(),
              name: material.name ?? "Attachment",
              url: material.url ?? "",
              type: material.type ?? "file",
            });
          }
        }

        return {
          title: data.post?.title ?? "",
          description: data.post?.description ?? null,
          video,
          materials,
        };
      } catch (error) {
        console.error("Failed to fetch post details:", error);
        return null;
      }
    },
    { locationId, postId }
  );
}

/**
 * Fetches the DRM license (HLS token) for a video asset.
 */
export async function fetchVideoLicense(
  page: Page,
  assetId: string
): Promise<{ url: string; token: string } | null> {
  return page.evaluate(async (assetId) => {
    try {
      const tokenKey = Object.keys(localStorage).find((k) => k.includes("firebase:authUser"));
      const tokenData = tokenKey ? JSON.parse(localStorage.getItem(tokenKey) ?? "{}") : null;
      const token = tokenData?.stsTokenManager?.accessToken;

      if (!token) {
        return null;
      }

      const res = await fetch(
        `https://backend.leadconnectorhq.com/assets-drm/assets-license/${assetId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!res.ok) {
        return null;
      }

      const data = await res.json();

      return {
        url: data.url ?? "",
        token: data.token ?? "",
      };
    } catch (error) {
      console.error("Failed to fetch video license:", error);
      return null;
    }
  }, assetId);
}

/**
 * Extracts complete post content including video and attachments.
 */
export async function extractHighLevelPostContent(
  page: Page,
  postUrl: string,
  locationId: string,
  productId: string,
  postId: string,
  categoryId: string
): Promise<HighLevelPostContent | null> {
  // Navigate to post page
  await page.goto(postUrl, { timeout: 30000 });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(3000);

  // Fetch post details from API
  const postDetails = await fetchPostDetails(page, locationId, postId);

  if (!postDetails) {
    console.error("Could not fetch post details");
    return null;
  }

  let video: HighLevelVideoInfo | null = null;

  // If post has a video asset, get the license URL
  if (postDetails.video?.assetId) {
    const license = await fetchVideoLicense(page, postDetails.video.assetId);

    if (license?.url) {
      video = {
        type: "hls",
        url: license.url,
        masterPlaylistUrl: license.url,
        token: license.token,
      };
    }
  }

  // Fallback: try to extract video from page
  if (!video) {
    video = await extractVideoFromPage(page);
  }

  // Extract HTML content
  const htmlContent = await page.evaluate(() => {
    const contentEl = document.querySelector(
      "[class*='post-content'], [class*='PostContent'], [class*='lesson-content'], article"
    );
    return contentEl?.innerHTML ?? null;
  });

  // Extract text description
  const description = await page.evaluate(() => {
    const descEl = document.querySelector(
      "[class*='description'], [class*='Description'], p:first-of-type"
    );
    return descEl?.textContent?.trim() ?? null;
  });

  return {
    id: postId,
    title: postDetails.title,
    description: description ?? postDetails.description,
    htmlContent,
    video,
    attachments: postDetails.materials.map((m) => ({
      id: m.id,
      name: m.name,
      url: m.url,
      type: m.type,
    })),
    categoryId,
    productId,
  };
}

/**
 * Parses an HLS master playlist to extract quality variants.
 */
export function parseHLSMasterPlaylist(
  content: string,
  baseUrl: string
): Array<{
  label: string;
  url: string;
  bandwidth: number;
  width?: number | undefined;
  height?: number | undefined;
}> {
  const variants: Array<{
    label: string;
    url: string;
    bandwidth: number;
    width?: number | undefined;
    height?: number | undefined;
  }> = [];

  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();

    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      // Parse attributes
      const bandwidthMatch = /BANDWIDTH=(\d+)/.exec(line);
      const resolutionMatch = /RESOLUTION=(\d+)x(\d+)/.exec(line);

      const bandwidth = bandwidthMatch ? parseInt(bandwidthMatch[1]!, 10) : 0;

      // Next line should be the URL
      const nextLine = lines[i + 1]?.trim() ?? "";
      if (nextLine && !nextLine.startsWith("#")) {
        const variantUrl = nextLine.startsWith("http") ? nextLine : new URL(nextLine, baseUrl).href;

        const height = resolutionMatch ? parseInt(resolutionMatch[2]!, 10) : undefined;
        const label = height ? `${height}p` : `${Math.round(bandwidth / 1000)}k`;

        const variant: {
          label: string;
          url: string;
          bandwidth: number;
          width?: number | undefined;
          height?: number | undefined;
        } = {
          label,
          url: variantUrl,
          bandwidth,
        };

        if (resolutionMatch) {
          variant.width = parseInt(resolutionMatch[1]!, 10);
          variant.height = parseInt(resolutionMatch[2]!, 10);
        }

        variants.push(variant);
      }
    }
  }

  // Sort by bandwidth (highest first)
  variants.sort((a, b) => b.bandwidth - a.bandwidth);

  return variants;
}

/**
 * Fetches and parses HLS playlist to get quality options.
 */
export async function getHLSQualities(
  page: Page,
  masterPlaylistUrl: string
): Promise<
  Array<{
    label: string;
    url: string;
    bandwidth: number;
    width?: number | undefined;
    height?: number | undefined;
  }>
> {
  try {
    const content = await page.evaluate(async (url) => {
      const res = await fetch(url);
      if (!res.ok) return null;
      return res.text();
    }, masterPlaylistUrl);

    if (!content) return [];

    return parseHLSMasterPlaylist(content, masterPlaylistUrl);
  } catch {
    return [];
  }
}

/**
 * Gets the best quality URL from an HLS master playlist.
 */
export async function getBestHLSQuality(
  page: Page,
  masterPlaylistUrl: string
): Promise<string | null> {
  const qualities = await getHLSQualities(page, masterPlaylistUrl);

  if (qualities.length === 0) {
    return masterPlaylistUrl;
  }

  // Return highest quality
  return qualities[0]?.url ?? null;
}
