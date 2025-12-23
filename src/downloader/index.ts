/**
 * Video download coordination - delegates to type-specific downloaders.
 */
import { downloadFile, downloadLoomVideo, type DownloadProgress } from "./loomDownloader.js";
import { downloadVimeoVideo } from "./vimeoDownloader.js";
import { downloadHighLevelVideo, downloadHLSVideo } from "./hlsDownloader.js";

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
  /** Optional preferred quality (e.g., "720p", "1080p") */
  preferredQuality?: string | undefined;
  /** Optional cookies for authenticated downloads */
  cookies?: string | undefined;
}

export interface DownloadResult {
  success: boolean;
  error?: string | undefined;
  errorCode?: string | undefined;
  details?: string | undefined;
}

/**
 * Downloads a video based on its type.
 */
export async function downloadVideo(
  task: VideoDownloadTask,
  onProgress?: (progress: DownloadProgress) => void
): Promise<DownloadResult> {
  const { videoUrl, videoType, outputPath, preferredQuality, cookies } = task;

  switch (videoType) {
    case "loom":
      return downloadLoomVideo(videoUrl, outputPath, onProgress);

    case "vimeo":
      return downloadVimeoVideo(videoUrl, outputPath, onProgress);

    case "native":
      // Direct MP4/WebM URL - download directly
      return downloadFile(videoUrl, outputPath, onProgress, cookies);

    case "hls":
      // Generic HLS stream
      return downloadHLSVideo(videoUrl, outputPath, onProgress, cookies);

    case "highlevel":
      // HighLevel HLS video with quality selection
      return downloadHighLevelVideo(videoUrl, outputPath, preferredQuality, onProgress, cookies);

    case "youtube":
    case "wistia":
      // These require yt-dlp or special handling
      return {
        success: false,
        error: `${videoType} videos are not yet supported. Consider installing yt-dlp. Video URL: ${videoUrl}`,
        errorCode: "UNSUPPORTED_TYPE",
      };

    case "unknown":
    default:
      // Try direct download as fallback
      if (/\.(mp4|webm|mov)(\?|$)/i.exec(videoUrl)) {
        return downloadFile(videoUrl, outputPath, onProgress, cookies);
      }
      // Try HLS if it looks like a playlist
      if (/\.m3u8(\?|$)/i.exec(videoUrl)) {
        return downloadHLSVideo(videoUrl, outputPath, onProgress, cookies);
      }
      return {
        success: false,
        error: `Unknown video type. URL: ${videoUrl}`,
      };
  }
}

export {
  downloadFile,
  downloadLoomVideo,
  extractLoomId,
  getLoomVideoInfoDetailed,
  type DownloadProgress,
  type LoomFetchResult,
} from "./loomDownloader.js";
export {
  downloadVimeoVideo,
  extractVimeoId,
  getVimeoVideoInfo,
  getVimeoVideoInfoFromBrowser,
  type VimeoDownloadResult,
  type VimeoFetchResult,
  type VimeoVideoInfo,
} from "./vimeoDownloader.js";
export { AsyncQueue, type QueueItem, type QueueOptions } from "./queue.js";
export {
  validateLoomHls,
  validateVideoHls,
  validateVimeoVideo,
  type HlsValidationResult,
} from "./hlsValidator.js";
export {
  checkFfmpeg,
  downloadHighLevelVideo,
  downloadHLSVideo,
  fetchHLSQualities,
  getBestQualityUrl,
  parseHighLevelVideoUrl,
  parseHLSPlaylist,
  type HLSDownloadResult,
  type HLSQuality,
} from "./hlsDownloader.js";
