import type { Page } from "playwright";
import { parseHLSPlaylist } from "../../downloader/shared/index.js";
import {
  detectVimeoEmbed,
  detectLoomEmbed,
  detectYouTubeEmbed,
  detectHlsVideo,
} from "../../shared/videoDetection.js";
import { PostDetailsResponseSchema, VideoLicenseResponseSchema, safeParse } from "./schemas.js";
import {
  getFirebaseAccessTokenFromPage,
  waitForFirebaseAccessTokenFromPage,
} from "../../shared/firebase.js";

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

/** Navigates to a post and waits for the auth state needed by its API requests. */
export async function navigateToHighLevelPost(page: Page, postUrl: string): Promise<void> {
  await page.goto(postUrl, { timeout: 30000 });
  await page.waitForLoadState("domcontentloaded");
  await waitForFirebaseAccessTokenFromPage(page);
}

// Browser/API automation - requires Playwright

/**
 * Extracts the Firebase auth token from the page.
 */
export const getAuthToken = getFirebaseAccessTokenFromPage;

/**
 * Extracts video info from a HighLevel post page using shared detection utilities.
 */
export async function extractVideoFromPage(page: Page): Promise<HighLevelVideoInfo | null> {
  // Check for HLS video
  const hlsUrl = await detectHlsVideo(page);
  if (hlsUrl) {
    return { type: "hls", url: hlsUrl, masterPlaylistUrl: hlsUrl };
  }

  // Check for Vimeo embed
  const vimeoUrl = await detectVimeoEmbed(page);
  if (vimeoUrl) {
    return { type: "vimeo", url: vimeoUrl };
  }

  // Check for Loom embed
  const loomUrl = await detectLoomEmbed(page);
  if (loomUrl) {
    return { type: "loom", url: loomUrl };
  }

  // Check for YouTube embed
  const youtubeUrl = await detectYouTubeEmbed(page);
  if (youtubeUrl) {
    return { type: "youtube", url: youtubeUrl };
  }

  return null;
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
  const authToken = await getAuthToken(page);
  if (!authToken) {
    console.warn("Could not fetch HighLevel post details: No auth token");
    return null;
  }

  let data: unknown;
  try {
    const response = await page.request.get(
      `https://services.leadconnectorhq.com/membership/locations/${locationId}/posts/${postId}?source=courses`,
      { headers: { Authorization: `Bearer ${authToken}` } }
    );
    if (!response.ok()) {
      console.warn(`Could not fetch HighLevel post details: HTTP ${response.status()}`);
      return null;
    }
    data = await response.json();
  } catch (error) {
    console.warn(`Could not fetch HighLevel post details: ${String(error)}`);
    return null;
  }

  // Validate response with Zod schema
  const parsed = safeParse(PostDetailsResponseSchema, data, "fetchPostDetails");
  if (!parsed) {
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
  await navigateToHighLevelPost(page, postUrl);

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

// Re-export for backwards compatibility
export { parseHLSMasterPlaylist };
