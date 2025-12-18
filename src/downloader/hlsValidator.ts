import { extractLoomId, getLoomVideoInfoDetailed } from "./loomDownloader.js";

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
    case "youtube":
    case "wistia":
      // For now, skip validation for other types
      // These could be implemented later with their own APIs
      return {
        isValid: true,
        hlsUrl: null,
        details: `${videoType} validation not implemented - will attempt download`,
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

