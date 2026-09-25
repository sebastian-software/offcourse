import { chromium, type Page } from "playwright";
import { expect, it } from "vitest";
import { readLearningSuitePlayerVideos } from "./playerMedia.js";
import { selectLearningSuiteCaption } from "./captions.js";
import { parseSegmentsUrl } from "../../downloader/shared/index.js";

async function withPlayer(run: (page: Page) => Promise<void>) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<hls-video></hls-video>");
    await page.locator("hls-video").evaluate((player) => {
      Object.assign(player, {
        src: "https://media.other-academy.test/assets/123/master.m3u8?token=old",
        api: {
          levels: [
            {
              height: 720,
              details: {
                live: false,
                totalduration: 8,
                fragments: [
                  {
                    url: "https://cdn.other-academy.test/assets/123/part.ts?token=old",
                    duration: 8,
                  },
                ],
              },
            },
          ],
        },
        play() {
          throw new Error("Metadata extraction must not start playback");
        },
      });
    });
    await run(page);
  } finally {
    await browser.close();
  }
}

it("supports another provider's URL layout and HTTPS/default subtitle tracks", async () => {
  await withPlayer(async (page) => {
    await page.route("https://cdn.other-academy.test/fr.vtt", (route) =>
      route.fulfill({
        contentType: "text/vtt",
        body: "WEBVTT\n\n00:00.000 --> 00:02.000\nBonjour\n",
      })
    );
    await page.locator("hls-video").evaluate((player) => {
      const track = document.createElement("track");
      track.src = "https://cdn.other-academy.test/fr.vtt";
      track.srclang = "fr";
      track.default = true;
      player.append(track);
    });
    const videos = await readLearningSuitePlayerVideos(page);
    expect(videos).toHaveLength(1);
    expect(videos[0]?.id).toMatch(/^source-/);
    expect(selectLearningSuiteCaption(videos[0]?.captions ?? [])?.language).toBe("fr");
    expect(videos[0]?.captions[0]?.vtt).toContain("Bonjour");
    expect(parseSegmentsUrl(videos[0]!.url)).toEqual([
      "https://cdn.other-academy.test/assets/123/part.ts?token=old",
    ]);
  });
});

it("keeps video extraction usable when optional subtitles are unavailable", async () => {
  await withPlayer(async (page) => {
    await page.route("https://cdn.other-academy.test/missing.vtt", (route) =>
      route.fulfill({ status: 404, body: "not found" })
    );
    await page.locator("hls-video").evaluate((player) => {
      const track = document.createElement("track");
      track.src = "https://cdn.other-academy.test/missing.vtt";
      player.append(track);
    });
    const videos = await readLearningSuitePlayerVideos(page);
    expect(videos).toHaveLength(1);
    expect(videos[0]?.captions).toEqual([]);
  });
});

it("does not treat an unfinished live playlist as a complete course video", async () => {
  await withPlayer(async (page) => {
    await page.locator("hls-video").evaluate((player) => {
      Object.assign(player, {
        api: {
          levels: [
            {
              height: 720,
              details: {
                live: true,
                totalduration: 8,
                fragments: [{ url: "https://cdn.example/part.ts", duration: 8 }],
              },
            },
          ],
        },
      });
      player.append(document.createElement("track"));
    });
    await expect(readLearningSuitePlayerVideos(page)).rejects.toThrow("no complete VOD playlist");
  });
});
