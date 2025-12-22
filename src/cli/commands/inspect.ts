import chalk from "chalk";
import ora from "ora";
import { join } from "node:path";
import { loadConfig } from "../../config/configManager.js";
import { expandPath } from "../../config/paths.js";
import { getAuthenticatedSession, isSkoolLoginPage } from "../../shared/auth.js";
import { ensureDir, outputFile } from "../../shared/fs.js";

const SKOOL_DOMAIN = "www.skool.com";
const SKOOL_LOGIN_URL = "https://www.skool.com/login";

interface InspectOptions {
  output?: string;
  full?: boolean;
  click?: boolean;
}

/**
 * Inspects the page structure and logs useful debugging info.
 */
export async function inspectCommand(url: string, options: InspectOptions): Promise<void> {
  console.log(chalk.blue("\n🔍 Page Inspector\n"));

  const config = loadConfig();
  const spinner = ora("Connecting...").start();

  let browser;
  let session;

  try {
    const result = await getAuthenticatedSession(
      {
        domain: SKOOL_DOMAIN,
        loginUrl: SKOOL_LOGIN_URL,
        isLoginPage: isSkoolLoginPage,
      },
      { headless: false } // Always visible for inspection
    );
    browser = result.browser;
    session = result.session;
    spinner.succeed("Connected");
  } catch (error) {
    spinner.fail("Failed to connect");
    console.log(chalk.red("\n❌ Please run: course-grab login\n"));
    process.exit(1);
  }

  try {
    // Collect network requests to find video URLs
    const videoRequests: Array<{ url: string; resourceType: string }> = [];
    session.page.on("request", (request) => {
      const reqUrl = request.url();
      const resourceType = request.resourceType();
      if (
        resourceType === "media" ||
        reqUrl.includes(".mp4") ||
        reqUrl.includes(".m3u8") ||
        reqUrl.includes(".webm") ||
        reqUrl.includes("vimeo") ||
        reqUrl.includes("wistia") ||
        reqUrl.includes("mux.com") ||
        reqUrl.includes("cloudflare") ||
        reqUrl.includes("stream")
      ) {
        videoRequests.push({ url: reqUrl, resourceType });
      }
    });

    const pageSpinner = ora("Loading page...").start();
    await session.page.goto(url, { timeout: 60000 });
    // Use domcontentloaded instead of networkidle - some pages never stop loading
    await session.page.waitForLoadState("domcontentloaded");
    // Give it a moment for JS to render
    await session.page.waitForTimeout(2000);
    pageSpinner.succeed("Page loaded");

    console.log(chalk.cyan("\n📄 Page Info:\n"));
    console.log(`   URL: ${session.page.url()}`);
    console.log(`   Title: ${await session.page.title()}`);

    // Look for video preview/placeholder elements
    const previewInfo = await session.page.evaluate(() => {
      const previews: Array<{
        selector: string;
        description: string;
        element: string;
      }> = [];

      // Common video preview patterns
      const previewSelectors = [
        // Play buttons
        '[class*="play"]',
        '[class*="Play"]',
        'button[class*="video"]',
        '[aria-label*="play" i]',
        '[aria-label*="Play" i]',
        // Thumbnail overlays
        '[class*="thumbnail"]',
        '[class*="poster"]',
        '[class*="preview"]',
        '[class*="cover"]',
        // SVG play icons
        'svg[class*="play"]',
        // Clickable video containers
        '[class*="video-container"]',
        '[class*="player-container"]',
        '[class*="video-wrapper"]',
        // Data attributes
        "[data-video]",
        "[data-video-id]",
        "[data-src]",
      ];

      for (const selector of previewSelectors) {
        const elements = document.querySelectorAll(selector);
        elements.forEach((el) => {
          const rect = el.getBoundingClientRect();
          // Only consider visible, reasonably sized elements
          if (rect.width > 50 && rect.height > 50) {
            previews.push({
              selector,
              description: `<${el.tagName.toLowerCase()}> class="${el.className}" (${Math.round(rect.width)}x${Math.round(rect.height)})`,
              element: el.outerHTML.substring(0, 200),
            });
          }
        });
      }

      return previews;
    });

    if (previewInfo.length > 0) {
      console.log(chalk.yellow("\n🎬 Potential Video Previews/Placeholders:\n"));
      const seen = new Set<string>();
      for (const preview of previewInfo) {
        if (seen.has(preview.description)) continue;
        seen.add(preview.description);
        console.log(`   ${preview.description}`);
        console.log(chalk.gray(`     selector: ${preview.selector}`));
        console.log(chalk.gray(`     html: ${preview.element.substring(0, 100)}...`));
      }
    }

    // If --click flag, try to click on video preview
    if (options.click) {
      console.log(chalk.cyan("\n👆 Attempting to click video preview...\n"));

      const clicked = await session.page.evaluate(() => {
        // Try various selectors for play button
        const playSelectors = [
          '[class*="play"]',
          '[class*="Play"]',
          'button[class*="video"]',
          '[class*="poster"]',
          '[class*="thumbnail"]',
          '[class*="video-container"]',
          '[class*="player"]',
        ];

        for (const selector of playSelectors) {
          const el = document.querySelector(selector);
          if (el && el instanceof HTMLElement) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 50 && rect.height > 50) {
              el.click();
              return { clicked: true, selector, element: el.outerHTML.substring(0, 100) };
            }
          }
        }
        return { clicked: false };
      });

      if (clicked.clicked) {
        console.log(chalk.green(`   ✓ Clicked on: ${clicked.selector}`));
        console.log(chalk.gray(`     ${clicked.element}...`));

        // Wait for video element to appear
        console.log(chalk.gray("   Waiting for video element..."));
        try {
          await session.page.waitForSelector(
            "video, iframe[src*='vimeo'], iframe[src*='wistia'], iframe[src*='youtube']",
            {
              timeout: 5000,
            }
          );
          console.log(chalk.green("   ✓ Video element appeared!"));
        } catch {
          console.log(chalk.yellow("   ⚠ No video element detected after click"));
        }

        // Small delay for any animations/loading
        await session.page.waitForTimeout(1000);
      } else {
        console.log(chalk.yellow("   ⚠ No clickable preview found"));
      }
    }

    // Analyze page structure
    const analysis = await session.page.evaluate(() => {
      const result: Record<string, unknown> = {};

      // Find all iframes (potential video embeds)
      const iframes = document.querySelectorAll("iframe");
      result.iframes = Array.from(iframes).map((iframe) => ({
        src: iframe.src,
        id: iframe.id,
        className: iframe.className,
        width: iframe.width,
        height: iframe.height,
      }));

      // Find all video elements
      const videos = document.querySelectorAll("video");
      result.videos = Array.from(videos).map((video) => ({
        src: video.src,
        poster: video.poster,
        className: video.className,
        sources: Array.from(video.querySelectorAll("source")).map((s) => ({
          src: s.src,
          type: s.type,
        })),
      }));

      // Find elements with video-related classes
      const videoRelated = document.querySelectorAll(
        '[class*="video"], [class*="player"], [class*="wistia"], [class*="vimeo"], [class*="embed"], [class*="media"]'
      );
      result.videoRelatedElements = Array.from(videoRelated).map((el) => ({
        tagName: el.tagName,
        className: el.className,
        id: el.id,
        dataAttributes: Object.fromEntries(
          Array.from(el.attributes)
            .filter((attr) => attr.name.startsWith("data-"))
            .map((attr) => [attr.name, attr.value])
        ),
        // Include src attributes that might have video URLs
        src: el.getAttribute("src"),
        href: el.getAttribute("href"),
      }));

      // Look for any script tags that might contain video configuration
      const scripts = document.querySelectorAll("script");
      const videoScripts: string[] = [];
      scripts.forEach((script) => {
        const content = script.textContent || "";
        if (
          content.includes("vimeo") ||
          content.includes("wistia") ||
          content.includes("video") ||
          content.includes("player") ||
          content.includes("mux") ||
          content.includes("cloudflare")
        ) {
          // Extract just the relevant parts
          const matches = content.match(/(https?:\/\/[^\s"']+\.(mp4|m3u8|webm|mov)[^\s"']*)/gi);
          if (matches) {
            videoScripts.push(...matches);
          }
          // Also look for video IDs
          const idMatches = content.match(/"(video[_-]?id|videoId|id)":\s*"([^"]+)"/gi);
          if (idMatches) {
            videoScripts.push(...idMatches);
          }
        }
      });
      result.videoScripts = [...new Set(videoScripts)];

      // Find navigation/sidebar elements (for lessons)
      const navElements = document.querySelectorAll(
        'nav, [class*="sidebar"], [class*="nav"], [class*="menu"], [class*="lesson"]'
      );
      result.navigationElements = Array.from(navElements)
        .slice(0, 10)
        .map((el) => ({
          tagName: el.tagName,
          className: el.className,
          id: el.id,
          childCount: el.children.length,
          links: Array.from(el.querySelectorAll("a")).map((a) => ({
            href: a.href,
            text: a.textContent?.trim().substring(0, 50),
          })),
        }));

      // Find main content area
      const contentAreas = document.querySelectorAll(
        'main, article, [class*="content"], [class*="post"], [class*="body"]'
      );
      result.contentAreas = Array.from(contentAreas)
        .slice(0, 5)
        .map((el) => ({
          tagName: el.tagName,
          className: el.className,
          id: el.id,
          textLength: el.textContent?.length ?? 0,
          hasVideo: el.querySelector("video, iframe") !== null,
        }));

      // Find all links to /classroom/
      const classroomLinks = document.querySelectorAll('a[href*="/classroom/"]');
      result.classroomLinks = Array.from(classroomLinks).map((a) => ({
        href: (a as HTMLAnchorElement).href,
        text: a.textContent?.trim().substring(0, 100),
        className: a.className,
        parentClass: a.parentElement?.className,
      }));

      // Get page structure overview
      const getAllClasses = (el: Element, depth = 0): string[] => {
        if (depth > 3) return [];
        const classes: string[] = [];
        if (el.className && typeof el.className === "string") {
          classes.push(`${"  ".repeat(depth)}${el.tagName}.${el.className.split(" ").join(".")}`);
        }
        Array.from(el.children).forEach((child) => {
          classes.push(...getAllClasses(child, depth + 1));
        });
        return classes;
      };

      result.bodyStructure = getAllClasses(document.body).slice(0, 100);

      return result;
    });

    // Output analysis
    console.log(chalk.cyan("\n🎬 Video Sources:\n"));
    if ((analysis.iframes as Array<{ src: string }>).length > 0) {
      console.log(chalk.yellow("   Iframes:"));
      for (const iframe of analysis.iframes as Array<{ src: string; className: string }>) {
        console.log(`   - ${iframe.src}`);
        console.log(chalk.gray(`     class: ${iframe.className}`));
      }
    }
    if ((analysis.videos as Array<{ src: string }>).length > 0) {
      console.log(chalk.yellow("\n   Video elements:"));
      for (const video of analysis.videos as Array<{
        src: string;
        sources: Array<{ src: string }>;
      }>) {
        console.log(`   - ${video.src || "(no src)"}`);
        for (const source of video.sources) {
          console.log(`     source: ${source.src}`);
        }
      }
    }

    // Show video URLs found in scripts
    const videoScripts = analysis.videoScripts as string[];
    if (videoScripts.length > 0) {
      console.log(chalk.yellow("\n   Video URLs from scripts:"));
      for (const url of videoScripts.slice(0, 10)) {
        console.log(chalk.green(`   - ${url}`));
      }
    }

    if ((analysis.videoRelatedElements as Array<{ className: string }>).length > 0) {
      console.log(chalk.yellow("\n   Video-related elements:"));
      for (const el of (
        analysis.videoRelatedElements as Array<{
          tagName: string;
          className: string;
          dataAttributes: Record<string, string>;
          src?: string;
        }>
      ).slice(0, 10)) {
        console.log(`   - <${el.tagName.toLowerCase()}> class="${el.className}"`);
        if (el.src) {
          console.log(chalk.green(`     src: ${el.src}`));
        }
        if (Object.keys(el.dataAttributes).length > 0) {
          console.log(chalk.gray(`     data: ${JSON.stringify(el.dataAttributes)}`));
        }
      }
    }

    console.log(chalk.cyan("\n📚 Classroom Links:\n"));
    for (const link of (
      analysis.classroomLinks as Array<{ href: string; text: string; className: string }>
    ).slice(0, 15)) {
      console.log(`   - ${link.text || "(no text)"}`);
      console.log(chalk.gray(`     ${link.href}`));
      console.log(chalk.gray(`     class: ${link.className}`));
    }

    console.log(chalk.cyan("\n🧭 Navigation Elements:\n"));
    for (const nav of analysis.navigationElements as Array<{
      tagName: string;
      className: string;
      links: Array<{ href: string; text: string }>;
    }>) {
      console.log(`   <${nav.tagName.toLowerCase()}> class="${nav.className}"`);
      if (nav.links.length > 0) {
        console.log(chalk.gray(`     Links: ${nav.links.length}`));
        for (const link of nav.links.slice(0, 5)) {
          console.log(chalk.gray(`       - ${link.text}: ${link.href}`));
        }
      }
    }

    // Save full analysis to file if requested
    if (options.output || options.full) {
      const outputDir = expandPath(options.output ?? config.outputDir);
      await ensureDir(outputDir);

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `inspect-${timestamp}.json`;
      const filepath = join(outputDir, filename);

      await outputFile(filepath, JSON.stringify(analysis, null, 2));
      console.log(chalk.green(`\n📁 Full analysis saved to: ${filepath}\n`));

      // Also save HTML
      if (options.full) {
        const html = await session.page.content();
        const htmlPath = join(outputDir, `inspect-${timestamp}.html`);
        await outputFile(htmlPath, html);
        console.log(chalk.green(`📁 HTML saved to: ${htmlPath}\n`));
      }
    }

    // Show network requests that looked like video
    if (videoRequests.length > 0) {
      console.log(chalk.cyan("\n📡 Video-related Network Requests:\n"));
      const seen = new Set<string>();
      for (const req of videoRequests) {
        if (seen.has(req.url)) continue;
        seen.add(req.url);
        console.log(chalk.green(`   - ${req.url.substring(0, 120)}`));
        console.log(chalk.gray(`     type: ${req.resourceType}`));
      }
    }

    console.log(chalk.gray("\n💡 Tips:"));
    console.log(chalk.gray("   - Use --click to trigger lazy-loaded video players"));
    console.log(chalk.gray("   - Use --full to save complete HTML for offline analysis\n"));
  } finally {
    await browser.close();
  }
}
