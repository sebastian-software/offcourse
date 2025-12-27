/**
 * Shared types for video downloaders.
 * Provides unified interfaces across all video providers (Loom, Vimeo, HLS, etc.)
 */

// ============================================================================
// Download Result Types
// ============================================================================

/**
 * Base result interface for all download operations.
 */
export interface DownloadResult {
  success: boolean;
  error?: string | undefined;
  errorCode?: string | undefined;
  details?: string | undefined;
  outputPath?: string | undefined;
}

/**
 * Extended result with duration info (used by HLS downloads).
 */
export interface DownloadResultWithDuration extends DownloadResult {
  duration?: number | undefined;
}

// ============================================================================
// Progress Types
// ============================================================================

/**
 * Download phase indicators.
 */
export type DownloadPhase = "preparing" | "downloading" | "merging" | "complete";

/**
 * Unified progress callback interface.
 * Supports both byte-based and segment-based progress tracking.
 */
export interface DownloadProgress {
  /** Progress percentage (0-100) */
  percent: number;
  /** Current download phase */
  phase?: DownloadPhase | undefined;
  /** Bytes downloaded so far */
  downloadedBytes?: number | undefined;
  /** Total bytes to download (if known) */
  totalBytes?: number | undefined;
  /** Segments downloaded (for HLS) */
  downloadedSegments?: number | undefined;
  /** Total segments (for HLS) */
  totalSegments?: number | undefined;
}

/**
 * Progress callback function type.
 */
export type ProgressCallback = (progress: DownloadProgress) => void;

// ============================================================================
// Video Info Types
// ============================================================================

/**
 * Common video metadata interface.
 */
export interface VideoInfo {
  /** Provider-specific video ID */
  id: string;
  /** Video title */
  title: string;
  /** Duration in seconds */
  duration: number;
  /** Video width in pixels */
  width: number;
  /** Video height in pixels */
  height: number;
  /** HLS playlist URL (if available) */
  hlsUrl: string | null;
  /** Direct progressive download URL (if available) */
  progressiveUrl?: string | null | undefined;
}

/**
 * Result of fetching video info from a provider.
 */
export interface FetchResult<T extends VideoInfo = VideoInfo> {
  success: boolean;
  info?: T | undefined;
  error?: string | undefined;
  errorCode?: string | undefined;
  statusCode?: number | undefined;
  details?: string | undefined;
}

// ============================================================================
// HLS Types
// ============================================================================

/**
 * HLS quality variant information.
 */
export interface HLSQuality {
  /** Human-readable label (e.g., "1080p") */
  label: string;
  /** Playlist URL for this quality */
  url: string;
  /** Bandwidth in bits per second */
  bandwidth: number;
  /** Video width (if known) */
  width?: number | undefined;
  /** Video height (if known) */
  height?: number | undefined;
}

/**
 * HLS validation result.
 */
export interface HlsValidationResult {
  isValid: boolean;
  hlsUrl: string | null;
  error?: string | undefined;
  errorCode?: string | undefined;
  details?: string | undefined;
}

// ============================================================================
// Common Error Codes
// ============================================================================

/**
 * Standard error codes used across all downloaders.
 */
export type CommonErrorCode =
  // URL/ID errors
  | "INVALID_URL"
  | "VIDEO_NOT_FOUND"
  // Access errors
  | "PRIVATE_VIDEO"
  | "DRM_PROTECTED"
  | "RATE_LIMITED"
  // Network errors
  | "NETWORK_ERROR"
  | "FETCH_FAILED"
  // Download errors
  | "DOWNLOAD_FAILED"
  | "NO_STREAM"
  | "NO_SEGMENTS"
  | "SEGMENT_FETCH_FAILED"
  // Tool errors
  | "FFMPEG_NOT_FOUND"
  | "FFMPEG_ERROR"
  | "MERGE_FAILED"
  // Parse errors
  | "PARSE_ERROR"
  // Other
  | "UNSUPPORTED_TYPE"
  | "UNKNOWN_ERROR";

// ============================================================================
// Download Options
// ============================================================================

/**
 * Common options for download operations.
 */
export interface DownloadOptions {
  /** Optional cookies for authenticated requests */
  cookies?: string | undefined;
  /** Optional referer URL */
  referer?: string | undefined;
  /** Optional auth token (API key) */
  authToken?: string | undefined;
  /** Preferred quality (e.g., "720p", "1080p") */
  preferredQuality?: string | undefined;
  /** Progress callback */
  onProgress?: ProgressCallback | undefined;
}

/**
 * HTTP headers for authenticated requests.
 */
export interface RequestHeaders {
  "User-Agent"?: string | undefined;
  Origin?: string | undefined;
  Referer?: string | undefined;
  Cookie?: string | undefined;
  Accept?: string | undefined;
  Authorization?: string | undefined;
  APIKEY?: string | undefined;
  [key: string]: string | undefined;
}
