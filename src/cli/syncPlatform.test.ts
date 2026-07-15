import { describe, expect, it } from "vitest";
import { detectSyncPlatform } from "./syncPlatform.js";

describe("detectSyncPlatform", () => {
  it.each([
    ["https://www.skool.com/community/classroom", "skool"],
    ["https://academy.learningsuite.io/student/course/example/id", "learningsuite"],
    ["https://piccalil.li/mindful-design/lessons", "piccalilli"],
    ["https://courses.joshwcomeau.com/css-for-js", "joshcomeau"],
    ["https://courses.joshwcomeau.com/wham/module/lesson", "joshcomeau"],
    ["https://courses.example.com/courses/products/example", "highlevel"],
  ] as const)("detects %s as %s", (url, platform) => {
    expect(detectSyncPlatform(url)).toBe(platform);
  });

  it("rejects unrecognized URLs instead of guessing HighLevel", () => {
    expect(detectSyncPlatform("https://example.com/course")).toBeNull();
    expect(detectSyncPlatform("https://evilskool.com/course")).toBeNull();
    expect(detectSyncPlatform("not-a-url")).toBeNull();
  });
});
