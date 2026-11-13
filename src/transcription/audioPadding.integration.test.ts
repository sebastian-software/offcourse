import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execa } from "execa";
import { expect, it } from "vitest";
import { withTrailingSilence } from "./audioPadding.js";

it.each([false, true])(
  "pads a temporary copy and cleans it up (recognition failure: %s)",
  async (fail) => {
    const root = await mkdtemp(join(tmpdir(), "offcourse-padding-test-"));
    let padded = "";
    try {
      const input = join(root, "speaker's recording.wav");
      await execa("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=16000:duration=1",
        "-c:a",
        "pcm_s16le",
        input,
      ]);
      const original = await readFile(input);
      const operation = withTrailingSilence(input, 2, async (path) => {
        padded = path;
        expect(path).not.toBe(input);
        const probe = await execa("ffprobe", [
          "-v",
          "error",
          "-show_entries",
          "format=duration",
          "-of",
          "default=noprint_wrappers=1:nokey=1",
          path,
        ]);
        expect(Number(probe.stdout)).toBeCloseTo(3, 2);
        if (fail) throw new Error("Recognition failed");
        return "transcript";
      });
      if (fail) await expect(operation).rejects.toThrow("Recognition failed");
      else await expect(operation).resolves.toBe("transcript");
      expect(await readFile(input)).toEqual(original);
      expect(padded).not.toBe("");
      expect(existsSync(dirname(padded))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);
