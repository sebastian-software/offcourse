/**
 * Shared utilities for video downloaders.
 */

// Types
export type {
  CommonErrorCode,
  DownloadOptions,
  DownloadPhase,
  DownloadProgress,
  DownloadResult,
  DownloadResultWithDuration,
  FetchResult,
  HLSQuality,
  HlsValidationResult,
  ProgressCallback,
  RequestHeaders,
  VideoInfo,
} from "./types.js";

// FFmpeg utilities
export {
  checkFfmpeg,
  concatSegments,
  downloadWithFfmpeg,
  mergeVideoAudio,
  parseFfmpegDuration,
  parseFfmpegTime,
} from "./ffmpeg.js";

// Progressive download
export { downloadFile, downloadProgressiveVideo } from "./progressiveDownload.js";

// Network requests and authenticated headers
export {
  buildAuthHeaders,
  fetchWithAuthRedirects,
  fetchWithRetry,
  isSameOrigin,
  sanitizeHeaderValue,
} from "./network.js";

// HLS download
export {
  createSegmentsUrl,
  downloadSegmentsToFile,
  downloadSegmentsWithMerge,
  getSegmentUrls,
  isSegmentsUrl,
  parseHLSPlaylist,
  parseHlsMasterPlaylistContent,
  parseHlsMasterPlaylist,
  parseHlsMediaPlaylistContent,
  parseSegmentsUrl,
  resolveHlsUri,
  SEGMENTS_URL_PREFIX,
  type SegmentDownloadResult,
} from "./hlsDownload.js";

// Vimeo config parsing
export {
  selectVimeoHlsUrl,
  selectVimeoProgressiveUrl,
  type VimeoCdnConfig,
  type VimeoHlsConfig,
  type VimeoProgressiveRendition,
} from "./vimeoConfig.js";
