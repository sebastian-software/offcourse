import { expect, it } from "vitest";
import { learningSuiteVideoId } from "./mediaIdentity.js";

it("preserves IDs already used by LearningSuite archives", () => {
  expect(
    learningSuiteVideoId(
      "https://media.example/course/video-123/playlist.m3u8",
      "https://cdn.example/part.ts"
    )
  ).toBe("video-123");
});
it("supports other tenant/CDN paths without changing IDs when access signatures rotate", () => {
  expect(
    learningSuiteVideoId(
      "https://media.example/playlist.m3u8?id=video&token=old",
      "https://cdn.example/assets/part.ts?Signature=old&Expires=1"
    )
  ).toBe(
    learningSuiteVideoId(
      "https://media.example/playlist.m3u8?token=new&id=video",
      "https://cdn.example/assets/part.ts?Expires=2&Signature=new"
    )
  );
});
it("keeps different media distinct even when a shared endpoint uses query IDs", () => {
  const segment = "https://cdn.example/segment.ts";
  expect(learningSuiteVideoId("https://media.example/playlist?id=one", segment)).not.toBe(
    learningSuiteVideoId("https://media.example/playlist?id=two", segment)
  );
});
it("keeps separate CDN asset paths distinct behind a common proxy", () => {
  const source = "https://media.example/playlist";
  expect(learningSuiteVideoId(source, "https://cdn.example/asset-one/part.ts")).not.toBe(
    learningSuiteVideoId(source, "https://cdn.example/asset-two/part.ts")
  );
});

it("uses the segment identity when a player exposes a temporary blob URL or no source", () => {
  const segment = "https://cdn.example/asset/part.ts";
  expect(learningSuiteVideoId("blob:https://academy.example/old", segment)).toBe(
    learningSuiteVideoId("blob:https://academy.example/new", segment)
  );
  expect(learningSuiteVideoId("", segment)).toBe(
    learningSuiteVideoId("blob:https://academy.example/new", segment)
  );
});
