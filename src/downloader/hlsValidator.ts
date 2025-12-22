/**
 * HLS stream validation - requires network access to verify streams.
 */
/* v8 ignore start */
import { extractLoomId, getLoomVideoInfoDetailed } from "./loomDownloader.js";
import {
  extractVimeoId,
  getVimeoVideoInfo,
  getVimeoVideoInfoFromBrowser,
} from "./vimeoDownloader.js";
import { captureLoomHls, captureVimeoConfig } from "../scraper/videoInterceptor.js";
import type { Page } from "playwright";

/**
 * Result of HLS validation.
 */
export interface HlsValidationResult {
  isValid: boolean;
  hlsUrl: string | null;
  error?: string;
  errorCode?: string;
  details?: string;
}

/**
 * Validates that a Loom video has an accessible HLS stream.
 * This should be called during the scanning phase to catch issues early.
 *
 * @param loomUrl - The Loom video URL
 * @param page - Optional Playwright page for network interception fallback
 */
export async function validateLoomHls(loomUrl: string, page?: Page): Promise<HlsValidationResult> {
  const videoId = extractLoomId(loomUrl);

  if (!videoId) {
    return {
      isValid: false,
      hlsUrl: null,
      error: "Invalid Loom URL - could not extract video ID",
      errorCode: "INVALID_URL",
      details: `URL: ${loomUrl}`,
    };
  }

  // First try direct API
  const result = await getLoomVideoInfoDetailed(videoId, 2, 500);

  if (result.success && result.info) {
    return {
      isValid: true,
      hlsUrl: result.info.hlsUrl,
    };
  }

  // If direct API failed and we have a page, try network interception
  if (page && result.errorCode === "HLS_NOT_FOUND") {
    const captured = await captureLoomHls(page, videoId, 15000);
    if (captured.hlsUrl) {
      return {
        isValid: true,
        hlsUrl: captured.hlsUrl,
        details: "Captured via network interception",
      };
    }
  }

  // Return the original error
  const validation: HlsValidationResult = {
    isValid: false,
    hlsUrl: null,
    error: result.error ?? "Failed to fetch Loom video info",
  };
  if (result.errorCode) {
    validation.errorCode = result.errorCode;
  }
  if (result.details) {
    validation.details = result.details;
  }
  return validation;
}

/**
 * Validates a Vimeo video has accessible streams.
 * @param vimeoUrl - The Vimeo video URL
 * @param page - Optional Playwright page for domain-restricted videos
 * @param lessonUrl - Optional lesson URL for referer-based access
 */
export async function validateVimeoVideo(
  vimeoUrl: string,
  page?: Page,
  lessonUrl?: string
): Promise<HlsValidationResult> {
  const videoId = extractVimeoId(vimeoUrl);

  if (!videoId) {
    return {
      isValid: false,
      hlsUrl: null,
      error: "Invalid Vimeo URL - could not extract video ID",
      errorCode: "INVALID_URL",
      details: `URL: ${vimeoUrl}`,
    };
  }

  // Extract unlisted hash if present
  const hashMatch =
    /vimeo\.com\/\d+\/([a-f0-9]+)/.exec(vimeoUrl) ?? /[?&]h=([a-f0-9]+)/.exec(vimeoUrl);
  const unlistedHash = hashMatch?.[1] ?? null;

  // First try direct fetch (works for public videos)
  let result = await getVimeoVideoInfo(videoId, unlistedHash, lessonUrl);

  // If video is private/restricted and we have a browser context, try browser-based fetch
  if (!result.success && result.errorCode === "PRIVATE_VIDEO" && page) {
    result = await getVimeoVideoInfoFromBrowser(page, videoId, unlistedHash);
  }

  // If still failing and we have a page, try extracting from the running player
  if (!result.success && result.errorCode === "PRIVATE_VIDEO" && page) {
    const captured = await captureVimeoConfig(page, videoId, 20000);
    if (captured.hlsUrl || captured.progressiveUrl) {
      return {
        isValid: true,
        hlsUrl: captured.hlsUrl ?? captured.progressiveUrl,
        details: "Extracted from running player",
      };
    }
  }

  if (!result.success || !result.info) {
    const validation: HlsValidationResult = {
      isValid: false,
      hlsUrl: null,
      error: result.error ?? "Failed to fetch Vimeo video info",
    };
    if (result.errorCode) {
      validation.errorCode = result.errorCode;
    }
    if (result.details) {
      validation.details = result.details;
    }
    return validation;
  }

  // Return HLS URL if available, or progressive URL as fallback
  return {
    isValid: true,
    hlsUrl: result.info.hlsUrl ?? result.info.progressiveUrl,
  };
}

/**
 * Validates HLS availability for a video URL based on its type.
 * @param videoUrl - The video URL to validate
 * @param videoType - The type of video (loom, vimeo, etc.)
 * @param page - Optional Playwright page for network interception fallback
 * @param lessonUrl - Optional lesson URL for referer-based access
 */
export async function validateVideoHls(
  videoUrl: string,
  videoType: string,
  page?: Page,
  lessonUrl?: string
): Promise<HlsValidationResult> {
  switch (videoType) {
    case "loom":
      return validateLoomHls(videoUrl, page);

    case "vimeo":
      return validateVimeoVideo(videoUrl, page, lessonUrl);

    case "youtube":
    case "wistia":
      // These require yt-dlp - skip validation, will fail at download
      return {
        isValid: true,
        hlsUrl: null,
        details: `${videoType} requires yt-dlp - will attempt download`,
      };

    case "native":
      // Native videos have direct URLs, no HLS needed
      return {
        isValid: true,
        hlsUrl: videoUrl,
      };

    default:
      return {
        isValid: false,
        hlsUrl: null,
        error: `Unknown video type: ${videoType}`,
        errorCode: "UNKNOWN_TYPE",
      };
  }
}
/* v8 ignore stop */
