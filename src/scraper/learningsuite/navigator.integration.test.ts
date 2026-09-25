import { chromium } from "playwright";
import type { EventEmitter } from "node:events";
import { expect, it } from "vitest";
import { installLearningSuiteDialogHandler } from "./navigator.js";
import { extractLearningSuitePostContent } from "./extractor.js";

it("extracts a tenant lesson with multiple generic media URLs without a welcome dialog or playback", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("https://academy.example.test/lesson", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<main><h3>Training lesson</h3><p data-slate-node="element">Lesson text</p><hls-video></hls-video><hls-video></hls-video></main>
        <script>
          window.playbackAttempts = 0;
          document.querySelectorAll('hls-video').forEach((player, index) => {
            Object.assign(player, {
              src: 'https://media.example.test/assets/' + index + '/master.m3u8',
              api: { levels: [{ height: 720, details: {
                live: false, totalduration: 8,
                fragments: [{url: 'https://cdn.example.test/assets/' + index + '/part.ts', duration: 8}]
              } }] },
              play() { window.playbackAttempts++; throw new Error('Playback forbidden'); }
            });
            Object.defineProperty(player, 'currentTime', { set() { window.playbackAttempts++; } });
            player.append(document.createElement('track'));
          });
        </script>`,
      })
    );
    const result = await extractLearningSuitePostContent(
      page,
      "https://academy.example.test/lesson",
      "tenant",
      "course",
      "lesson"
    );
    expect(result?.title).toBe("Training lesson");
    expect(result?.htmlContent).toContain("Lesson text");
    expect(result?.videos).toHaveLength(2);
    expect(result?.videos?.[0]?.id).not.toBe(result?.videos?.[1]?.id);
    expect(result?.video).toEqual(result?.videos?.[0]);
    expect(
      await page.evaluate(
        () => (window as unknown as { playbackAttempts: number }).playbackAttempts
      )
    ).toBe(0);
  } finally {
    await browser.close();
  }
});

it("removes media listeners after failed navigation on a reused worker page", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("https://academy.example.test/**", (route) => route.abort());
    const events = page as unknown as EventEmitter;
    const requests = events.listenerCount("request");
    const responses = events.listenerCount("response");

    await expect(
      extractLearningSuitePostContent(
        page,
        "https://academy.example.test/lesson",
        "tenant",
        "course",
        "lesson"
      )
    ).rejects.toThrow();

    expect(events.listenerCount("request")).toBe(requests);
    expect(events.listenerCount("response")).toBe(responses);
  } finally {
    await browser.close();
  }
});

it("dismisses a late welcome dialog without submitting its embedded form", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await installLearningSuiteDialogHandler(page);
    await page.setContent(`
      <button onclick="document.body.dataset.opened = 'yes'">Open module</button>
      <div class="MuiDialog-root" style="position:fixed;inset:0;background:white;z-index:5">
        <h2>Willkommen zurück!</h2>
        <form onsubmit="event.preventDefault();document.body.dataset.submitted = 'yes'">
          <button type="submit">Absenden</button>
        </form>
      </div>
      <script>
        setTimeout(() => {
          const close = document.createElement('button');
          close.textContent = 'Schließen';
          close.onclick = () => close.parentElement.remove();
          document.querySelector('.MuiDialog-root').append(close);
        }, 100);
      </script>
    `);

    await page.getByRole("button", { name: "Open module" }).click();

    expect(await page.locator("body").getAttribute("data-opened")).toBe("yes");
    expect(await page.locator("body").getAttribute("data-submitted")).toBeNull();
    expect(await page.locator(".MuiDialog-root").count()).toBe(0);
  } finally {
    await browser.close();
  }
});

it("uses the explicit close icon when a welcome form's footer button does not dismiss it", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await installLearningSuiteDialogHandler(page);
    await page.setContent(`
      <button onclick="document.body.dataset.opened = 'yes'">Open module</button>
      <div class="MuiDialog-root" style="position:fixed;inset:0;background:white;z-index:5">
        <button>Schließen</button>
        <button onclick="this.parentElement.remove()"><svg data-icon="xmark"></svg></button>
      </div>
    `);

    await page.getByRole("button", { name: "Open module" }).click();

    expect(await page.locator("body").getAttribute("data-opened")).toBe("yes");
    expect(await page.locator(".MuiDialog-root").count()).toBe(0);
  } finally {
    await browser.close();
  }
});

it("reads all HLS players and captions without playing or seeking", async () => {
  const { readLearningSuitePlayerVideos } = await import("./playerMedia.js");
  const { parseSegmentsUrl } = await import("../../downloader/shared/index.js");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<hls-video></hls-video><hls-video></hls-video>");
    await page.locator("hls-video").evaluateAll((elements) => {
      for (const [index, element] of elements.entries()) {
        Object.assign(element, {
          src: `https://api.example.com/course/video-${index}/playlist.m3u8`,
          api: {
            levels: [
              {
                height: 1080,
                details: {
                  live: false,
                  totalduration: 8,
                  fragments: [0, 1].map((part) => ({
                    url: `https://cdn.example.com/video-${index}/video${part}.ts?token=private`,
                    duration: 4,
                  })),
                },
              },
            ],
          },
        });
        const track = document.createElement("track");
        track.srclang = "de";
        track.label = "Original (de)";
        track.src = URL.createObjectURL(
          new Blob(["WEBVTT\n\n00:00.000 --> 00:02.000\nHallo Welt\n"], { type: "text/vtt" })
        );
        element.append(track);
      }
    });

    const videos = await readLearningSuitePlayerVideos(page);

    expect(videos.map((video) => video.id)).toEqual(["video-0", "video-1"]);
    expect(videos[0]?.captions[0]?.vtt).toContain("Hallo Welt");
    expect(parseSegmentsUrl(videos[1]!.url)).toEqual([
      "https://cdn.example.com/video-1/video0.ts?token=private",
      "https://cdn.example.com/video-1/video1.ts?token=private",
    ]);
  } finally {
    await browser.close();
  }
});
