import { expect, it } from "vitest";
import { learningSuiteCaptionText } from "./captions.js";

it("preserves multiline cue text without IDs, timings, styles, or notes", () => {
  expect(
    learningSuiteCaptionText(
      `WEBVTT\r\n\r\nNOTE Generated subtitle\r\n\r\n1\r\n00:00.000 --> 00:02.000 align:start\r\n<v Speaker>Hallo &amp; willkommen</v>\r\nim Kurs.\r\n\r\n00:02.000 --> 00:04.000\r\nNächster Satz.\r\n`
    )
  ).toBe("Hallo & willkommen im Kurs.\n\nNächster Satz.");
});
