import { isLearningSuitePortal } from "../scraper/learningsuite/index.js";
import { isPiccalilliCourseUrl } from "../scraper/piccalilli/index.js";
import { isSkoolUrl } from "../state/index.js";
import { isHighLevelPortal } from "./commands/syncHighLevel.js";

export type SyncPlatform = "skool" | "learningsuite" | "piccalilli" | "highlevel";

/** Returns the supported platform for an auto-detected sync URL. */
export function detectSyncPlatform(url: string): SyncPlatform | null {
  if (isSkoolUrl(url)) return "skool";
  if (isLearningSuitePortal(url)) return "learningsuite";
  if (isPiccalilliCourseUrl(url)) return "piccalilli";
  if (isHighLevelPortal(url)) return "highlevel";
  return null;
}
