import { isLearningSuitePortal } from "../scraper/learningsuite/index.js";
import { isJoshComeauCourseUrl } from "../scraper/joshcomeau/index.js";
import { isPiccalilliCourseUrl } from "../scraper/piccalilli/index.js";
import { isSkoolUrl } from "../state/index.js";
import { isHighLevelPortal } from "./commands/syncHighLevel.js";

export type SyncPlatform = "skool" | "learningsuite" | "piccalilli" | "joshcomeau" | "highlevel";

/** Returns the supported platform for an auto-detected sync URL. */
export function detectSyncPlatform(url: string): SyncPlatform | null {
  if (isSkoolUrl(url)) return "skool";
  if (isLearningSuitePortal(url)) return "learningsuite";
  if (isPiccalilliCourseUrl(url)) return "piccalilli";
  // Check before HighLevel because its broad courses.*.com matcher also matches this host.
  if (isJoshComeauCourseUrl(url)) return "joshcomeau";
  if (isHighLevelPortal(url)) return "highlevel";
  return null;
}
