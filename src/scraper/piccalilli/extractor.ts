import type { Page, Request } from "playwright";
import { dirname } from "node:path";
import { convertHtmlToMarkdown } from "../extractor.js";
import { ensureDir, outputBinaryFile } from "../../shared/fs.js";

export interface PiccalilliResource {
  url: string;
  filename: string;
}

export interface PiccalilliVideo {
  embedUrl: string;
  hlsUrl: string | null;
  referer: string;
}

export interface PiccalilliLessonContent {
  title: string;
  htmlContent: string;
  markdownContent: string;
  resources: PiccalilliResource[];
  video: PiccalilliVideo | null;
}

export interface PiccalilliResourceDownloadResult {
  success: boolean;
  error?: string | undefined;
}

const BUNNY_EMBED_PREFIX = "https://iframe.mediadelivery.net/embed/";

export function extractHlsUrlFromBunnyHtml(html: string): string | null {
  const normalized = html.replaceAll("&amp;", "&").replaceAll("\\/", "/");
  const match =
    /(https?:\/\/[^"'\s<>]+(?:b-cdn\.net|mediadelivery\.net)[^"'\s<>]*\.m3u8[^"'\s<>]*)/i.exec(
      normalized
    );
  return match?.[1] ?? null;
}

export function getPiccalilliResourceFilename(url: string, fallbackIndex = 0): string {
  try {
    const pathname = new URL(url).pathname;
    const lastPart = pathname.split("/").filter(Boolean).pop();
    if (lastPart) {
      return decodeURIComponent(lastPart).replace(/[<>:"/\\|?*]/g, "_");
    }
  } catch {
    // Fall through to a deterministic filename.
  }
  return `resource-${fallbackIndex + 1}`;
}

export function formatPiccalilliMarkdown(
  content: PiccalilliLessonContent,
  localVideoFilename?: string
): string {
  const lines = [`# ${content.title}`, ""];

  if (content.video) {
    const videoTarget = localVideoFilename
      ? `[Open downloaded video](./${localVideoFilename})`
      : content.video.embedUrl;
    lines.push(`> Video: ${videoTarget}`, "");
  }

  if (content.markdownContent.trim()) {
    lines.push(content.markdownContent.trim(), "");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

/** Rewrites downloaded Piccalilli resource URLs to sibling offline files. */
export function rewritePiccalilliResourceLinks(
  markdown: string,
  resources: { url: string; localFilename: string }[]
): string {
  let result = markdown;
  for (const resource of resources) {
    result = result.replaceAll(resource.url, `./${resource.localFilename}`);
    try {
      result = result.replaceAll(new URL(resource.url).pathname, `./${resource.localFilename}`);
    } catch {
      // Ignore invalid URLs; the absolute replacement above still handles plain strings.
    }
  }
  return result;
}

function chooseObservedHlsUrl(urls: string[]): string | null {
  return (
    urls.find((url) => /\/playlist\.m3u8(?:\?|$)/.test(url)) ??
    urls.find((url) => url.includes(".m3u8")) ??
    null
  );
}

async function resolveBunnyHlsUrl(
  page: Page,
  embedUrl: string,
  lessonUrl: string,
  observedHlsUrls: string[]
): Promise<string | null> {
  const observed = chooseObservedHlsUrl(observedHlsUrls);
  if (observed) return observed;

  const bunnyFrame = page.frames().find((frame) => frame.url().startsWith(BUNNY_EMBED_PREFIX));
  if (bunnyFrame) {
    const source = bunnyFrame.locator('source[src*=".m3u8"]');
    if ((await source.count()) > 0) {
      const sourceUrl = await source.first().getAttribute("src");
      if (sourceUrl) return sourceUrl;
    }
  }

  try {
    const response = await page.request.get(embedUrl, {
      headers: { Referer: lessonUrl },
      timeout: 30000,
    });
    if (response.ok()) {
      return extractHlsUrlFromBunnyHtml(await response.text());
    }
  } catch {
    // The caller will report an unresolved player if all strategies fail.
  }

  return null;
}

/** Extracts lesson text, downloadable resources and Bunny HLS metadata. */
export async function extractPiccalilliLesson(
  page: Page,
  lessonUrl: string
): Promise<PiccalilliLessonContent> {
  const observedHlsUrls: string[] = [];
  const requestHandler = (request: Request) => {
    if (request.url().includes(".m3u8")) observedHlsUrls.push(request.url());
  };

  page.on("request", requestHandler);
  try {
    if (page.url() !== lessonUrl) {
      await page.goto(lessonUrl, { timeout: 30000 });
      await page.waitForLoadState("domcontentloaded");
    }

    await page.waitForSelector(".course-lesson-hero__heading", { timeout: 10000 });

    const accessRequired = await page.evaluate(
      () =>
        document.querySelector('form[action="/login"]') !== null ||
        /access required/i.test(document.body.textContent ?? "")
    );
    if (accessRequired) {
      throw new Error(`Access required for ${lessonUrl}`);
    }

    await page
      .waitForSelector('.master-grid.flow.prose, iframe[src*="iframe.mediadelivery.net/embed/"]', {
        timeout: 10000,
      })
      .catch(() => {});
    await page.waitForTimeout(500);

    const extracted = await page.evaluate(() => {
      const title =
        document.querySelector(".course-lesson-hero__heading")?.textContent?.trim() ??
        document.title.split(" - Piccalilli")[0]?.trim() ??
        "Untitled lesson";
      const root = document.querySelector(".master-grid.flow.prose");
      if (!root) {
        return { title, htmlContent: "", embedUrl: null, resourceUrls: [] as string[] };
      }

      const excludedSelectors = [
        "figure",
        ".split-pair",
        ".block-action",
        ".promo-box",
        ".author-summary",
      ];
      const container = document.createElement("div");
      for (const child of Array.from(root.children)) {
        if (excludedSelectors.some((selector) => child.matches(selector))) continue;
        container.append(child.cloneNode(true));
      }
      container.querySelectorAll("script, style, svg").forEach((element) => {
        element.remove();
      });

      const resourceUrls = Array.from(root.querySelectorAll<HTMLAnchorElement>("a[href]"))
        .filter(
          (link) =>
            link.hasAttribute("download") || new URL(link.href).pathname.includes("/downloads/")
        )
        .map((link) => link.href);

      return {
        title,
        htmlContent: container.innerHTML,
        embedUrl:
          root.querySelector<HTMLIFrameElement>('iframe[src*="iframe.mediadelivery.net/embed/"]')
            ?.src ?? null,
        resourceUrls: [...new Set(resourceUrls)],
      };
    });

    const resources = extracted.resourceUrls.map((url, index) => ({
      url,
      filename: getPiccalilliResourceFilename(url, index),
    }));

    let video: PiccalilliVideo | null = null;
    if (extracted.embedUrl) {
      video = {
        embedUrl: extracted.embedUrl,
        hlsUrl: await resolveBunnyHlsUrl(page, extracted.embedUrl, lessonUrl, observedHlsUrls),
        referer: lessonUrl,
      };
    }

    return {
      title: extracted.title,
      htmlContent: extracted.htmlContent,
      markdownContent: convertHtmlToMarkdown(extracted.htmlContent),
      resources,
      video,
    };
  } finally {
    page.off("request", requestHandler);
  }
}

/** Downloads a course resource through the authenticated browser context. */
export async function downloadPiccalilliResource(
  page: Page,
  resourceUrl: string,
  outputPath: string,
  referer: string
): Promise<PiccalilliResourceDownloadResult> {
  try {
    const response = await page.request.get(resourceUrl, {
      headers: { Referer: referer },
      timeout: 30000,
    });
    if (!response.ok()) {
      return { success: false, error: `HTTP ${response.status()}` };
    }

    await ensureDir(dirname(outputPath));
    await outputBinaryFile(outputPath, await response.body());
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
