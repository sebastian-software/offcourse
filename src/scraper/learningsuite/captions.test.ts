import { expect, it } from "vitest";
import { learningSuiteCaptionText, selectLearningSuiteCaption } from "./captions.js";

it("uses provider order or the default track without assuming a German portal", () => {
  const tracks = [{ language: "fr" }, { language: "de" }, { language: "en", isDefault: true }];
  expect(selectLearningSuiteCaption(tracks)).toBe(tracks[2]);
  expect(selectLearningSuiteCaption(tracks.slice(0, 2))).toBe(tracks[0]);
  expect(selectLearningSuiteCaption<{ language: string }>([])).toBeUndefined();
});

it("matches explicit language preferences before the provider default", () => {
  const tracks = [{ language: "fr", isDefault: true }, { language: "en" }, { language: "en-US" }];
  expect(selectLearningSuiteCaption(tracks, "EN_us")).toBe(tracks[2]);
  expect(selectLearningSuiteCaption(tracks, "en-GB")).toBe(tracks[1]);
  expect(selectLearningSuiteCaption(tracks, "de-DE")).toBe(tracks[0]);
});

it("preserves multiline cue text without IDs, timings, styles, or notes", () => {
  expect(
    learningSuiteCaptionText(
      `WEBVTT\r\n\r\nNOTE Generated subtitle\r\n\r\n1\r\n00:00.000 --> 00:02.000 align:start\r\n<v Speaker>Hallo &amp; willkommen</v>\r\nim Kurs.\r\n\r\n00:02.000 --> 00:04.000\r\nNächster Satz.\r\n`
    )
  ).toBe("Hallo & willkommen im Kurs.\n\nNächster Satz.");
});
