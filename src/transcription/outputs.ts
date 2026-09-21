import { randomUUID } from "node:crypto";
import { readFile, writeFile, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { cuttledocTranscriptionSchema, type CuttledocTranscription } from "./cuttledoc.js";

export interface TranscriptOutputPaths {
  jsonPath: string;
  markdownPath: string;
}

export function transcriptOutputPaths(videoPath: string): TranscriptOutputPaths {
  const stem = basename(videoPath, extname(videoPath)) || basename(videoPath);
  return {
    jsonPath: join(dirname(videoPath), `${stem}.transcript.json`),
    markdownPath: join(dirname(videoPath), `${stem}.transcript.md`),
  };
}

export async function inspectTranscriptOutputs(videoPath: string): Promise<{
  result: CuttledocTranscription | null;
  hasMarkdown: boolean;
}> {
  const paths = transcriptOutputPaths(videoPath);
  let result: CuttledocTranscription | null = null;
  try {
    const parsed = cuttledocTranscriptionSchema.safeParse(
      JSON.parse(await readFile(paths.jsonPath, "utf8"))
    );
    if (parsed.success) result = parsed.data;
  } catch (error) {
    if (!(error instanceof SyntaxError) && !isMissing(error)) throw error;
  }
  let hasMarkdown = false;
  try {
    const info = await stat(paths.markdownPath);
    hasMarkdown = info.isFile() && info.size > 0;
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  return { result, hasMarkdown };
}

export async function writeTranscriptMarkdown(
  path: string,
  title: string,
  text: string
): Promise<void> {
  await writeAtomic(path, [`# ${title}`, "", text.trim(), ""].join("\n"));
}

export async function writeTranscriptOutputs(
  videoPath: string,
  title: string,
  result: CuttledocTranscription,
  replaceMarkdown: boolean
): Promise<void> {
  const paths = transcriptOutputPaths(videoPath);
  await writeAtomic(paths.jsonPath, `${JSON.stringify(result, null, 2)}\n`);
  if (replaceMarkdown) await writeTranscriptMarkdown(paths.markdownPath, title, result.text);
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
