import type { Page } from "playwright";
import { createSegmentsUrl } from "../../downloader/shared/index.js";
import { learningSuiteVideoId } from "./mediaIdentity.js";

interface PlayerFragment {
  url: string;
  duration: number;
}
interface PlayerLevel {
  height: number;
  details?: { live: boolean; totalduration: number; fragments: PlayerFragment[] };
}
interface HlsVideoElement extends HTMLElement {
  src: string;
  api?: { levels: PlayerLevel[] };
}

export interface LearningSuiteCaption {
  language: string;
  label: string;
  vtt: string;
  isDefault?: boolean;
}

export interface LearningSuitePlayerVideo {
  id: string;
  type: "hls";
  url: string;
  duration: number;
  captions: LearningSuiteCaption[];
}

/**
 * Read the public hls-video API. The player has already loaded the complete VOD
 * playlist for metadata, so downloading does not require playback or seeking.
 * https://github.com/muxinc/media-elements/tree/main/packages/hls-video-element
 */
export async function readLearningSuitePlayerVideos(
  page: Page
): Promise<LearningSuitePlayerVideo[]> {
  if ((await page.locator("hls-video").count()) === 0) return [];

  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll<HlsVideoElement>("hls-video")).every((player) =>
        player.api?.levels.some((level) => level.details?.fragments.length)
      ),
    undefined,
    { timeout: 15000 }
  );

  // Caption blobs are populated separately from the video metadata.
  await page
    .locator("hls-video track")
    .first()
    .waitFor({ state: "attached", timeout: 1000 })
    .catch(() => {});

  const media = await page.locator("hls-video").evaluateAll(async (elements) => {
    return Promise.all(
      elements.map(async (element) => {
        const player = element as HlsVideoElement;
        const level = player.api?.levels
          .filter((candidate) => candidate.details?.fragments.length)
          .sort((a, b) => b.height - a.height)[0];
        const details = level?.details;
        if (!details || details.live)
          throw new Error("LearningSuite player has no complete VOD playlist");
        const fragments = details.fragments;
        if (!fragments.every((fragment) => /^https:\/\//i.test(fragment.url))) {
          throw new Error("LearningSuite playlist contains an unavailable fragment");
        }
        const captions = await Promise.all(
          Array.from(player.querySelectorAll("track")).map(async (track) => {
            if (!["subtitles", "captions"].includes(track.kind)) return null;
            if (!/^(?:blob:|data:text\/vtt|https?:\/\/)/iu.test(track.src)) return null;
            try {
              const response = await fetch(track.src, { signal: AbortSignal.timeout(5000) });
              if (!response.ok) return null;
              const vtt = await response.text();
              return /^\uFEFF?WEBVTT\b/u.test(vtt)
                ? { language: track.srclang, label: track.label, vtt, isDefault: track.default }
                : null;
            } catch {
              return null;
            }
          })
        );
        return {
          source: player.src,
          duration: details.totalduration,
          segments: fragments.map((fragment) => fragment.url),
          captions: captions.filter((caption) => caption !== null),
        };
      })
    );
  });

  return media.map(({ source, segments, ...video }) => ({
    ...video,
    id: learningSuiteVideoId(source, segments[0] ?? source),
    type: "hls",
    url: createSegmentsUrl(segments),
  }));
}
