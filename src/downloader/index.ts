import { downloadFile, downloadLoomVideo, extractLoomId, type DownloadProgress } from "./loomDownloader.js";

export interface VideoDownloadTask {
  lessonName: string;
  videoUrl: string;
  videoType: "loom" | "vimeo" | "youtube" | "wistia" | "native" | "unknown" | null;
  outputPath: string;
}

export interface DownloadResult {
  success: boolean;
  error?: string;
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

    case "native":
      // Direct MP4/WebM URL - download directly
      return downloadFile(videoUrl, outputPath, onProgress);

    case "vimeo":
    case "youtube":
    case "wistia":
      // For now, return an error suggesting these need special handling
      // We can add support for these later
      return {
        success: false,
        error: `${videoType} videos are not yet supported. Video URL: ${videoUrl}`,
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

export { downloadFile, downloadLoomVideo, extractLoomId, type DownloadProgress };
export { AsyncQueue, type QueueItem, type QueueOptions } from "./queue.js";

