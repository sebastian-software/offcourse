import type { Frame, Page } from "playwright";
import { dirname } from "node:path";
import { convertHtmlToMarkdown } from "../extractor.js";
import { ensureDir, outputBinaryFile } from "../../shared/fs.js";

export interface JoshComeauResource {
  url: string;
  filename: string;
}

export interface JoshComeauVideo {
  embedUrl: string;
  hlsUrl: string | null;
  referer: string;
}

export interface JoshComeauLessonContent {
  title: string;
  htmlContent: string;
  markdownContent: string;
  resources: JoshComeauResource[];
  videos: JoshComeauVideo[];
}

export interface JoshComeauResourceDownloadResult {
  success: boolean;
  error?: string | undefined;
}

interface VimeoHlsConfig {
  default_cdn?: string;
  cdns?: Record<string, { avc_url?: string; url?: string }>;
}

const JOSH_COMEAU_LESSON_ROOT_SELECTOR =
  '[data-test="unlocked-content"], [class*="LessonContent__Wrapper"]';
const JOSH_COMEAU_VIDEO_SELECTOR = 'iframe[src*="player.vimeo.com/video/"]';
const JOSH_COMEAU_RESOURCE_SELECTOR = "a[download]";

export function chooseVimeoHlsUrl(hls: VimeoHlsConfig | null | undefined): string | null {
  if (!hls?.cdns) return null;
  const preferred = [
    hls.default_cdn,
    "akfire_interconnect_quic",
    "akamai_live",
    "fastly_skyfire",
    "fastly",
  ].filter((value): value is string => Boolean(value));

  for (const key of preferred) {
    const cdn = hls.cdns[key];
    const url = cdn?.avc_url ?? cdn?.url;
    if (url) return url;
  }

  for (const cdn of Object.values(hls.cdns)) {
    const url = cdn.avc_url ?? cdn.url;
    if (url) return url;
  }
  return null;
}

function extractJsonObject(scriptText: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < scriptText.length; index++) {
    const character = scriptText[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth++;
    } else if (character === "}") {
      depth--;
      if (depth === 0) return scriptText.slice(start, index + 1);
    }
  }

  return null;
}

/** Extracts the HLS URL from Vimeo's persistent inline player configuration. */
export function extractVimeoHlsUrlFromPlayerScript(scriptText: string): string | null {
  const assignment = "window.playerConfig =";
  const assignmentIndex = scriptText.indexOf(assignment);
  if (assignmentIndex < 0) return null;
  const jsonStart = scriptText.indexOf("{", assignmentIndex + assignment.length);
  if (jsonStart < 0) return null;
  const json = extractJsonObject(scriptText, jsonStart);
  if (!json) return null;

  try {
    const config = JSON.parse(json) as {
      request?: { files?: { hls?: VimeoHlsConfig } };
    };
    return chooseVimeoHlsUrl(config.request?.files?.hls);
  } catch {
    return null;
  }
}

export function getJoshComeauResourceFilename(url: string, fallbackIndex = 0): string {
  try {
    const lastPart = new URL(url).pathname.split("/").filter(Boolean).pop();
    if (lastPart) return decodeURIComponent(lastPart).replace(/[<>:"/\\|?*]/g, "_");
  } catch {
    // Fall through to a deterministic filename.
  }
  return `resource-${fallbackIndex + 1}`;
}

export function formatJoshComeauMarkdown(
  content: JoshComeauLessonContent,
  localVideoFilenames: string[] = []
): string {
  const lines = [`# ${content.title}`, ""];

  content.videos.forEach((video, index) => {
    const localFilename = localVideoFilenames[index];
    const target = localFilename ? `[Open downloaded video](./${localFilename})` : video.embedUrl;
    const label = content.videos.length > 1 ? `Video ${index + 1}` : "Video";
    lines.push(`> ${label}: ${target}`, "");
  });

  if (content.markdownContent.trim()) lines.push(content.markdownContent.trim(), "");
  return `${lines.join("\n").trimEnd()}\n`;
}

export function rewriteJoshComeauResourceLinks(
  markdown: string,
  resources: { url: string; localFilename: string }[]
): string {
  let result = markdown;
  for (const resource of resources) {
    const localUrl = `./${resource.localFilename}`;
    result = replaceMarkdownDestination(result, resource.url, localUrl);
    try {
      result = replaceMarkdownDestination(result, new URL(resource.url).pathname, localUrl);
    } catch {
      // Ignore invalid URLs.
    }
  }
  return result;
}

function replaceMarkdownDestination(markdown: string, from: string, to: string): string {
  return markdown.replaceAll(`](${from})`, `](${to})`).replaceAll(`](<${from}>)`, `](<${to}>)`);
}

async function resolveVimeoHlsUrl(frame: Frame): Promise<string | null> {
  await frame
    .waitForFunction(
      () => {
        const playerWindow = globalThis as typeof globalThis & {
          playerConfig?: { request?: { files?: { hls?: VimeoHlsConfig } } };
        };
        return (
          Boolean(playerWindow.playerConfig?.request?.files?.hls) ||
          Array.from(document.querySelectorAll("script:not([src])")).some((script) =>
            script.textContent?.includes("window.playerConfig =")
          )
        );
      },
      undefined,
      { timeout: 10000 }
    )
    .catch(() => {});

  const playerConfig = await frame
    .evaluate(() => {
      const playerWindow = globalThis as typeof globalThis & {
        playerConfig?: { request?: { files?: { hls?: VimeoHlsConfig } } };
      };
      const scriptText = Array.from(document.querySelectorAll("script:not([src])"))
        .map((script) => script.textContent ?? "")
        .find((text) => text.includes("window.playerConfig ="));
      return {
        hls: playerWindow.playerConfig?.request?.files?.hls ?? null,
        scriptText: scriptText ?? "",
      };
    })
    .catch(() => ({ hls: null, scriptText: "" }));
  return (
    chooseVimeoHlsUrl(playerConfig.hls) ??
    extractVimeoHlsUrlFromPlayerScript(playerConfig.scriptText)
  );
}

async function resolveVimeoHlsUrlForPage(page: Page, videoId: string): Promise<string | null> {
  const timeoutAt = Date.now() + 10000;
  do {
    const frame = page.frames().find((candidate) => candidate.url().includes(`/video/${videoId}`));
    if (frame) return resolveVimeoHlsUrl(frame);
    await page.waitForTimeout(250);
  } while (Date.now() < timeoutAt);
  return null;
}

/** Extracts lesson text, downloadable resources, and all Vimeo streams. */
export async function extractJoshComeauLesson(
  page: Page,
  lessonUrl: string
): Promise<JoshComeauLessonContent> {
  if (page.url() !== lessonUrl) {
    await page.goto(lessonUrl, { timeout: 30000 });
    await page.waitForLoadState("domcontentloaded");
  }

  await page.waitForSelector(JOSH_COMEAU_LESSON_ROOT_SELECTOR, {
    state: "attached",
    timeout: 15000,
  });

  const evaluateLesson = () =>
    page.evaluate((rootSelector) => {
      const root =
        document.querySelector<HTMLElement>('[data-test="unlocked-content"]') ??
        document.querySelector<HTMLElement>(rootSelector);
      if (!root) throw new Error("Josh Comeau lesson content is locked or unavailable");

      const title =
        root.querySelector("#lesson-title, h1")?.textContent?.trim() ??
        document.querySelector("h1")?.textContent?.trim() ??
        document.title.split(" • ")[0]?.trim() ??
        "Untitled lesson";
      const embedUrls = Array.from(
        root.querySelectorAll<HTMLIFrameElement>('iframe[src*="player.vimeo.com/video/"]')
      ).map((iframe) => iframe.src);
      const resourceUrls = Array.from(root.querySelectorAll<HTMLAnchorElement>("a[href]"))
        .filter((link) => link.hasAttribute("download"))
        .map((link) => link.href);

      const clone = root.cloneNode(true) as HTMLElement;
      clone.querySelector("#lesson-title")?.remove();
      clone.querySelectorAll('[class*="VideoPlayer__Wrapper"]').forEach((element) => {
        element.remove();
      });
      clone
        .querySelectorAll(
          'script, style, svg, iframe, video, button, input, textarea, [data-test="complete-lesson-button"]'
        )
        .forEach((element) => {
          element.remove();
        });

      return {
        title,
        htmlContent: clone.innerHTML,
        embedUrls: [...new Set(embedUrls)],
        resourceUrls: [...new Set(resourceUrls)],
      };
    }, JOSH_COMEAU_LESSON_ROOT_SELECTOR);

  let extracted = await evaluateLesson();
  const hydrationWaits: Promise<unknown>[] = [];
  if (extracted.embedUrls.length === 0) {
    hydrationWaits.push(
      page
        .waitForSelector(JOSH_COMEAU_VIDEO_SELECTOR, { state: "attached", timeout: 3000 })
        .catch(() => {})
    );
  }
  if (extracted.resourceUrls.length === 0) {
    hydrationWaits.push(
      page
        .waitForSelector(JOSH_COMEAU_RESOURCE_SELECTOR, { state: "attached", timeout: 3000 })
        .catch(() => {})
    );
  }
  if (hydrationWaits.length > 0) {
    await Promise.all(hydrationWaits);
    extracted = await evaluateLesson();
  }

  const resources = extracted.resourceUrls.map((url, index) => ({
    url,
    filename: getJoshComeauResourceFilename(url, index),
  }));
  const videos: JoshComeauVideo[] = [];
  for (const embedUrl of extracted.embedUrls) {
    const videoId = /player\.vimeo\.com\/video\/(\d+)/.exec(embedUrl)?.[1];
    videos.push({
      embedUrl,
      hlsUrl: videoId ? await resolveVimeoHlsUrlForPage(page, videoId) : null,
      referer: lessonUrl,
    });
  }

  return {
    title: extracted.title,
    htmlContent: extracted.htmlContent,
    markdownContent: convertHtmlToMarkdown(extracted.htmlContent),
    resources,
    videos,
  };
}

export async function downloadJoshComeauResource(
  page: Page,
  resourceUrl: string,
  outputPath: string,
  referer: string
): Promise<JoshComeauResourceDownloadResult> {
  try {
    const response = await page.request.get(resourceUrl, {
      headers: { Referer: referer },
      timeout: 30000,
    });
    if (!response.ok()) return { success: false, error: `HTTP ${response.status()}` };

    await ensureDir(dirname(outputPath));
    await outputBinaryFile(outputPath, await response.body());
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
