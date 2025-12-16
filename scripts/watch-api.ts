/**
 * Script to watch Skool API calls and find progress tracking endpoints.
 * Run with: npx tsx scripts/watch-api.ts
 */

import { chromium } from "playwright";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const SESSION_PATH = join(homedir(), ".course-grab", "sessions", "www.skool.com.json");

interface StorageState {
  cookies: Array<{ name: string; value: string; domain: string; path: string }>;
  origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
}

async function main() {
  console.log("\n🔍 Skool API Watcher\n");
  console.log("This will open a browser window. Watch for API calls while you:");
  console.log("  1. Navigate to a lesson");
  console.log("  2. Play/watch a video");
  console.log("  3. Complete a lesson\n");
  console.log("Press Ctrl+C to stop.\n");

  // Load session
  if (!existsSync(SESSION_PATH)) {
    console.error("❌ No session found. Run: course-grab login");
    process.exit(1);
  }

  const storageState: StorageState = JSON.parse(readFileSync(SESSION_PATH, "utf-8"));

  // Launch browser
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState });
  const page = await context.newPage();

  // Track API calls
  const apiCalls: Array<{
    method: string;
    url: string;
    postData?: string;
    response?: string;
    status?: number;
  }> = [];

  // Log all XHR/Fetch requests
  page.on("request", (request) => {
    const resourceType = request.resourceType();
    if (resourceType === "xhr" || resourceType === "fetch") {
      const method = request.method();
      const url = request.url();
      const postData = request.postData();

      // Filter out noise
      if (
        url.includes("sentry") ||
        url.includes("stripe") ||
        url.includes("awswaf") ||
        url.includes("analytics") ||
        url.includes("google")
      ) {
        return;
      }

      const call = { method, url, postData: postData?.substring(0, 1000) };
      apiCalls.push(call);

      if (method === "POST" || method === "PUT" || method === "PATCH") {
        console.log(`\n📤 ${method} ${url}`);
        if (postData) {
          try {
            const parsed = JSON.parse(postData);
            console.log("   Body:", JSON.stringify(parsed, null, 2).substring(0, 500));
          } catch {
            console.log("   Body:", postData.substring(0, 200));
          }
        }
      } else if (url.includes("progress") || url.includes("complete") || url.includes("track")) {
        console.log(`\n📥 ${method} ${url}`);
      }
    }
  });

  // Log responses for progress-related endpoints
  page.on("response", async (response) => {
    const url = response.url();
    const request = response.request();
    const resourceType = request.resourceType();

    if (resourceType === "xhr" || resourceType === "fetch") {
      if (
        url.includes("progress") ||
        url.includes("complete") ||
        url.includes("track") ||
        url.includes("lesson") ||
        url.includes("module") ||
        request.method() !== "GET"
      ) {
        try {
          const body = await response.text();
          console.log(`   Response ${response.status()}:`, body.substring(0, 300));
        } catch {
          // Ignore
        }
      }
    }
  });

  // Navigate to classroom
  console.log("📚 Navigating to Skool classroom...\n");
  await page.goto("https://www.skool.com/marketingminds/classroom");
  await page.waitForLoadState("networkidle");

  console.log("\n✅ Browser ready. Interact with the page to see API calls.");
  console.log("   Look for endpoints with 'progress', 'complete', 'lesson' etc.\n");

  // Keep running until Ctrl+C
  await new Promise(() => {});
}

main().catch(console.error);

