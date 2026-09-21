import chalk from "chalk";
import { loadConfig } from "../../config/configManager.js";
import { expandPath } from "../../config/paths.js";
import { createShutdownManager } from "../../shared/shutdown.js";
import { enrichArchive, type EnrichArchiveOptions } from "../../transcription/archive.js";

export type EnrichOptions = Pick<
  EnrichArchiveOptions,
  | "force"
  | "dryRun"
  | "cuttledocPath"
  | "transcriptionLanguage"
  | "transcriptionBackend"
  | "transcriptionEnhancement"
>;

export async function enrichCommand(
  directory: string | undefined,
  options: EnrichOptions
): Promise<void> {
  const config = loadConfig();
  const shutdown = createShutdownManager();
  shutdown.setup();
  const root = expandPath(directory ?? config.outputDir);
  console.log(chalk.blue(`\nEnriching videos in ${root}\n`));
  const summary = await enrichArchive(root, config, {
    ...options,
    shouldContinue: shutdown.shouldContinue,
    onProgress: (path, phase) => {
      console.log(chalk.gray(`   ${phase}: ${path}`));
    },
  });
  console.log(
    `\n${summary.discovered} videos: ${summary.completed} transcribed, ${summary.restored} restored, ${summary.skipped} already complete, ${summary.pending} pending, ${summary.failures.length} failed.`
  );
  for (const failure of summary.failures)
    console.error(chalk.red(`${failure.path}: ${failure.message}`));
  if (summary.failures.length > 0)
    throw new Error(
      "Some transcripts could not be generated. Rerun enrich to retry missing transcripts."
    );
}
