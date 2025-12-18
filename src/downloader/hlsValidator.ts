import { extractLoomId, getLoomVideoInfoDetailed } from "./loomDownloader.js";
import { extractVimeoId, getVimeoVideoInfo } from "./vimeoDownloader.js";

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
 */
export async function validateLoomHls(loomUrl: string): Promise<HlsValidationResult> {
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

  const result = await getLoomVideoInfoDetailed(videoId, 2, 500);

  if (!result.success || !result.info) {
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

  return {
    isValid: true,
    hlsUrl: result.info.hlsUrl,
  };
}

/**
 * Validates a Vimeo video has accessible streams.
 */
export async function validateVimeoVideo(vimeoUrl: string): Promise<HlsValidationResult> {
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
  const hashMatch = vimeoUrl.match(/vimeo\.com\/\d+\/([a-f0-9]+)/) ?? vimeoUrl.match(/[?&]h=([a-f0-9]+)/);
  const unlistedHash = hashMatch?.[1] ?? null;

  const result = await getVimeoVideoInfo(videoId, unlistedHash);

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
 */
export async function validateVideoHls(
  videoUrl: string,
  videoType: string
): Promise<HlsValidationResult> {
  switch (videoType) {
    case "loom":
      return validateLoomHls(videoUrl);

    case "vimeo":
      return validateVimeoVideo(videoUrl);

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

