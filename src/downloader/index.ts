import { downloadFile, downloadLoomVideo, type DownloadProgress } from "./loomDownloader.js";
import { downloadVimeoVideo } from "./vimeoDownloader.js";

export interface VideoDownloadTask {
  lessonId: number;
  lessonName: string;
  videoUrl: string;
  videoType: "loom" | "vimeo" | "youtube" | "wistia" | "native" | "unknown" | null;
  outputPath: string;
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
  const { videoUrl, videoType, outputPath } = task;

  switch (videoType) {
    case "loom":
      return downloadLoomVideo(videoUrl, outputPath, onProgress);

    case "vimeo":
      return downloadVimeoVideo(videoUrl, outputPath, onProgress);

    case "native":
      // Direct MP4/WebM URL - download directly
      return downloadFile(videoUrl, outputPath, onProgress);

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
      if (videoUrl.match(/\.(mp4|webm|mov)(\?|$)/i)) {
        return downloadFile(videoUrl, outputPath, onProgress);
      }
      return {
        success: false,
        error: `Unknown video type. URL: ${videoUrl}`,
      };
  }
}

export { downloadFile, downloadLoomVideo, extractLoomId, getLoomVideoInfoDetailed, type DownloadProgress, type LoomFetchResult } from "./loomDownloader.js";
export { downloadVimeoVideo, extractVimeoId, getVimeoVideoInfo, getVimeoVideoInfoFromBrowser, type VimeoDownloadResult, type VimeoFetchResult, type VimeoVideoInfo } from "./vimeoDownloader.js";
export { AsyncQueue, type QueueItem, type QueueOptions } from "./queue.js";
export { validateLoomHls, validateVideoHls, validateVimeoVideo, type HlsValidationResult } from "./hlsValidator.js";

