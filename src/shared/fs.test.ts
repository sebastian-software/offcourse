import { mkdtemp, rm, stat, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureDir, outputJson } from "./fs.js";

const createdPaths: string[] = [];
const posixIt = process.platform === "win32" ? it.skip : it;

afterEach(async () => {
  await Promise.all(
    createdPaths.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe("filesystem permissions", () => {
  posixIt("tightens existing directory permissions", async () => {
    const root = await mkdtemp(join(tmpdir(), "offcourse-fs-"));
    createdPaths.push(root);
    const directory = join(root, "sessions");

    await ensureDir(directory, { mode: 0o755 });
    await ensureDir(directory, { mode: 0o700 });

    expect((await stat(directory)).mode & 0o777).toBe(0o700);
  });

  posixIt("writes private JSON and tightens an existing file", async () => {
    const root = await mkdtemp(join(tmpdir(), "offcourse-fs-"));
    createdPaths.push(root);
    const file = join(root, "session.json");
    await writeFile(file, "{}", { mode: 0o644 });
    await chmod(file, 0o644);

    await outputJson(file, { token: "secret" }, { mode: 0o600 });

    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });
});
