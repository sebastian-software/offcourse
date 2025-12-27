import type { Page } from "playwright";
import { parseHLSPlaylist } from "../../downloader/shared/index.js";
import {
  FirebaseAuthTokenSchema,
  PostDetailsResponseSchema,
  VideoLicenseResponseSchema,
  safeParse,
  type FirebaseAuthRaw,
} from "./schemas.js";

// Alias for backwards compatibility and internal use
const parseHLSMasterPlaylist = parseHLSPlaylist;

export interface HighLevelVideoInfo {
  type: "hls" | "vimeo" | "loom" | "youtube" | "custom";
  url: string;
  masterPlaylistUrl?: string;
  qualities?: {
    label: string;
    url: string;
    width?: number;
    height?: number;
  }[];
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
  attachments: {
    id: string;
    name: string;
    url: string;
    type: string;
    size?: number;
  }[];
  categoryId: string;
  productId: string;
}

// Browser/API automation - requires Playwright
/* v8 ignore start */

/**
 * Extracts the Firebase auth token from the page.
 */
export async function getAuthToken(page: Page): Promise<string | null> {
  const rawData = await page.evaluate((): FirebaseAuthRaw | null => {
    const tokenKey = Object.keys(localStorage).find((k) => k.includes("firebase:authUser"));
    if (!tokenKey) return null;

    try {
      return JSON.parse(localStorage.getItem(tokenKey) ?? "{}") as FirebaseAuthRaw;
    } catch {
      return null;
    }
  });

  if (!rawData) return null;

  const parsed = safeParse(FirebaseAuthTokenSchema, rawData, "getAuthToken");
  return parsed?.stsTokenManager.accessToken ?? null;
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
      const src = video.currentSrc ?? video.src;
      if (src?.includes(".m3u8")) {
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
  materials: {
    id: string;
    name: string;
    url: string;
    type: string;
  }[];
} | null> {
  // Fetch raw data from browser context
  type FetchResult = { error: string; status?: number } | { data: unknown };

  const rawData = await page.evaluate(
    async ({ locationId, postId }): Promise<FetchResult> => {
      try {
        const tokenKey = Object.keys(localStorage).find((k) => k.includes("firebase:authUser"));
        const tokenData = tokenKey
          ? (JSON.parse(localStorage.getItem(tokenKey) ?? "{}") as FirebaseAuthRaw)
          : null;
        const token = tokenData?.stsTokenManager?.accessToken;

        if (!token) {
          return { error: "No auth token" };
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
          return { error: `HTTP ${res.status}`, status: res.status };
        }

        const data: unknown = await res.json();
        return { data };
      } catch (error) {
        return { error: String(error) };
      }
    },
    { locationId, postId }
  );

  // Debug: Log raw response in Node context
  if ("error" in rawData) {
    console.log(`[DEBUG] API Error: ${rawData.error}`);
    return null;
  }

  const data = rawData.data;
  if (!data) {
    console.log("[DEBUG] No data in response");
    return null;
  }

  // Validate response with Zod schema
  const parsed = safeParse(PostDetailsResponseSchema, data, "fetchPostDetails");
  if (!parsed) {
    console.log("[DEBUG] Response validation failed");
    return null;
  }

  // The API returns data directly (not nested under .post)
  // Check both for backwards compatibility
  const post = parsed.post ?? parsed;

  let video: { assetId: string; url: string } | null = null;

  // Check for video directly on post
  // Video can have: id, assetId, assetsLicenseId, or direct url
  if (post.video) {
    const videoAssetId = post.video.assetsLicenseId ?? post.video.assetId ?? post.video.id;
    if (videoAssetId || post.video.url) {
      video = {
        assetId: videoAssetId ?? "",
        url: post.video.url ?? "",
      };
    }
  }

  // Check posterImage for video asset (older format)
  if (!video && post.posterImage?.assetId) {
    video = {
      assetId: post.posterImage.assetId,
      url: post.posterImage.url ?? "",
    };
  }

  // Check for video in contentBlock
  if (!video && post.contentBlock) {
    for (const block of post.contentBlock) {
      if (block.type === "video") {
        const blockAssetId = block.assetsLicenseId ?? block.assetId ?? block.id;
        if (blockAssetId || block.url) {
          video = {
            assetId: blockAssetId ?? "",
            url: block.url ?? "",
          };
          break;
        }
      }
    }
  }

  const materials: {
    id: string;
    name: string;
    url: string;
    type: string;
  }[] = [];

  // Materials can be under 'materials' or 'post_materials'
  const materialsList = post.materials ?? post.post_materials ?? [];
  for (const material of materialsList) {
    materials.push({
      id: material.id ?? crypto.randomUUID(),
      name: material.name ?? "Attachment",
      url: material.url ?? "",
      type: material.type ?? "file",
    });
  }

  return {
    title: post.title ?? "",
    description: post.description ?? null,
    video,
    materials,
  };
}

/**
 * Fetches the DRM license (HLS token) for a video asset.
 */
export async function fetchVideoLicense(
  page: Page,
  assetId: string
): Promise<{ url: string; token: string } | null> {
  // Get auth token first
  const authToken = await getAuthToken(page);
  if (!authToken) {
    return null;
  }

  try {
    // Use page.request to make the API call (bypasses CORS)
    const response = await page.request.get(
      `https://backend.leadconnectorhq.com/assets-drm/assets-license/${assetId}`,
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      }
    );

    if (!response.ok()) {
      return null;
    }

    const data: unknown = await response.json();

    // Validate response with Zod schema
    const parsed = safeParse(VideoLicenseResponseSchema, data, "fetchVideoLicense");
    if (!parsed) {
      return null;
    }

    return {
      url: parsed.url,
      token: parsed.token,
    };
  } catch (error) {
    console.error("Failed to fetch video license:", error);
    return null;
  }
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

  // Check if we have video data
  if (postDetails.video) {
    // Option 1: Direct MP4 URL (preferred - no DRM)
    if (postDetails.video.url?.endsWith(".mp4")) {
      video = {
        type: "custom", // Direct download, not HLS
        url: postDetails.video.url,
      };
    }
    // Option 2: Get HLS license URL via assetId
    else if (postDetails.video.assetId) {
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
  }

  // Fallback: try to extract video from page DOM
  video ??= await extractVideoFromPage(page);

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
/* v8 ignore stop */

// Re-export for backwards compatibility
export { parseHLSMasterPlaylist };

/* v8 ignore start */
/**
 * Fetches and parses HLS playlist to get quality options.
 */
export async function getHLSQualities(
  page: Page,
  masterPlaylistUrl: string
): Promise<
  {
    label: string;
    url: string;
    bandwidth: number;
    width?: number | undefined;
    height?: number | undefined;
  }[]
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
/* v8 ignore stop */
