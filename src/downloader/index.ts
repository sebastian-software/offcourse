/**
 * Video download coordination - delegates to type-specific downloaders.
 */
import { downloadLoomVideo } from "./loomDownloader.js";
import { downloadVimeoVideo } from "./vimeoDownloader.js";
import { downloadHighLevelVideo, downloadHLSVideo } from "./hlsDownloader.js";
import { downloadFile, type DownloadResult, type ProgressCallback } from "./shared/index.js";

export interface VideoDownloadTask {
  lessonId: number;
  lessonName: string;
  videoUrl: string;
  videoType:
    | "loom"
    | "vimeo"
    | "youtube"
    | "wistia"
    | "native"
    | "hls"
    | "highlevel"
    | "unknown"
    | null;
  outputPath: string;
  preferredQuality?: string | undefined;
  cookies?: string | undefined;
  referer?: string | undefined;
  authToken?: string | undefined;
}

/**
 * Downloads a video based on its type.
 */
export async function downloadVideo(
  task: VideoDownloadTask,
  onProgress?: ProgressCallback
): Promise<DownloadResult> {
  const { videoUrl, videoType, outputPath, preferredQuality, cookies, referer, authToken } = task;

  switch (videoType) {
    case "loom":
      return downloadLoomVideo(videoUrl, outputPath, onProgress);

    case "vimeo":
      return downloadVimeoVideo(videoUrl, outputPath, onProgress);

    case "native":
      return downloadFile(videoUrl, outputPath, { onProgress, cookies, referer });

    case "hls":
      return downloadHLSVideo(videoUrl, outputPath, onProgress, cookies, referer, authToken);

    case "highlevel":
      return downloadHighLevelVideo(
        videoUrl,
        outputPath,
        preferredQuality,
        onProgress,
        cookies,
        referer,
        authToken
      );

    case "youtube":
    case "wistia":
      return {
        success: false,
        error: `${videoType} videos are not yet supported. Consider installing yt-dlp. Video URL: ${videoUrl}`,
        errorCode: "UNSUPPORTED_TYPE",
      };

    case "unknown":
    default:
      if (/\.(mp4|webm|mov)(\?|$)/i.exec(videoUrl)) {
        return downloadFile(videoUrl, outputPath, { onProgress, cookies, referer });
      }
      if (/\.m3u8(\?|$)/i.exec(videoUrl)) {
        return downloadHLSVideo(videoUrl, outputPath, onProgress, cookies, referer, authToken);
      }
      return {
        success: false,
        error: `Unknown video type. URL: ${videoUrl}`,
      };
  }
}

// Loom
export {
  downloadLoomVideo,
  extractLoomId,
  getLoomVideoInfoDetailed,
  type LoomDownloadResult,
  type LoomFetchResult,
  type LoomVideoInfo,
} from "./loomDownloader.js";

// Vimeo
export {
  downloadVimeoVideo,
  extractVimeoId,
  getVimeoVideoInfo,
  getVimeoVideoInfoFromBrowser,
  type VimeoDownloadResult,
  type VimeoFetchResult,
  type VimeoVideoInfo,
} from "./vimeoDownloader.js";

// HLS
export {
  downloadHighLevelVideo,
  downloadHLSVideo,
  fetchHLSQualities,
  getBestQualityUrl,
  parseHighLevelVideoUrl,
  type HLSDownloadResult,
} from "./hlsDownloader.js";

// Queue
export { AsyncQueue, type QueueItem, type QueueOptions } from "./queue.js";

// Validator
export { validateLoomHls, validateVideoHls, validateVimeoVideo } from "./hlsValidator.js";

// Shared utilities & types
export {
  checkFfmpeg,
  createSegmentsUrl,
  downloadFile,
  isSegmentsUrl,
  parseHLSPlaylist,
  parseSegmentsUrl,
  SEGMENTS_URL_PREFIX,
  type DownloadOptions,
  type DownloadPhase,
  type DownloadProgress,
  type DownloadResult,
  type DownloadResultWithDuration,
  type FetchResult,
  type HlsValidationResult,
  type HLSQuality,
  type ProgressCallback,
  type VideoInfo,
} from "./shared/index.js";
