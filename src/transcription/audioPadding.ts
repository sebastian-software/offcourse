import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";

/** Run recognition against an audio-only copy with a little silence after EOF. */
export async function withTrailingSilence<T>(
  inputPath: string,
  seconds: number,
  run: (paddedPath: string) => Promise<T>
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "offcourse-transcription-"));
  try {
    const paddedPath = join(directory, "padded.wav");
    await execa("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      "-vn",
      "-af",
      `apad=pad_dur=${seconds}`,
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      paddedPath,
    ]);
    return await run(paddedPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
