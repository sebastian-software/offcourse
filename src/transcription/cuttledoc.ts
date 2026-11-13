import { execa } from "execa";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import type { Config } from "../config/schema.js";
import { withTrailingSilence } from "./audioPadding.js";

const enhancementSchema = z.looseObject({
  backend: z.string(),
  model: z.string(),
  outcome: z.enum(["applied", "raw_fallback"]),
  fallback_reason: z.string().nullable(),
  fallback_detail: z.string().nullable(),
  prompt_id: z.string(),
  prompt_sha256: z.string(),
  processing_duration_ms: z.number().nonnegative(),
});

export const cuttledocTranscriptionSchema = z.looseObject({
  schema_version: z.literal("1.0.0"),
  kind: z.literal("transcription"),
  raw_text: z.string(),
  text: z.string(),
  language: z.string().nullable(),
  backend: z.string(),
  model: z.string().nullable(),
  media_duration_ms: z.number().nonnegative(),
  processing_duration_ms: z.number().nonnegative(),
  enhancement: enhancementSchema.nullable(),
});

export type CuttledocTranscription = z.infer<typeof cuttledocTranscriptionSchema>;
export type TranscriptionEnhancement = Config["transcriptionEnhancement"];

export interface TranscriptionCliOptions {
  transcribe?: boolean;
  cuttledocPath?: string;
  transcriptionLanguage?: string;
  transcriptionBackend?: string;
  transcriptionEnhancement?: string;
}

export interface CuttledocProcessOptions {
  executable: string;
  language: string;
  backend: string;
  enhancement: TranscriptionEnhancement;
}

export interface CuttledocProcessOutput {
  stdout: string;
  stderr: string;
}

export type CuttledocProcessRunner = (
  executable: string,
  arguments_: string[]
) => Promise<CuttledocProcessOutput>;

export interface CuttledocTranscriptionRun {
  result: CuttledocTranscription;
  wallDurationMs: number;
  progressOutput: string;
}

export class CuttledocCliError extends Error {
  readonly code: string;
  readonly exitCode: number | undefined;

  constructor(message: string, code: string, exitCode?: number) {
    super(message);
    this.name = "CuttledocCliError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

const defaultRunner: CuttledocProcessRunner = async (executable, arguments_) => {
  const result = await execa(executable, arguments_, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  return { stdout: result.stdout, stderr: result.stderr };
};

export function resolveCuttledocProcessOptions(
  config: Config,
  cli: TranscriptionCliOptions
): CuttledocProcessOptions {
  const enhancement = cli.transcriptionEnhancement ?? config.transcriptionEnhancement;
  if (enhancement !== "off" && enhancement !== "local" && enhancement !== "gemini") {
    throw new CuttledocCliError(
      `Unsupported transcription enhancement mode: ${enhancement}`,
      "CUTTLEDOC_CONFIG_INVALID"
    );
  }

  return {
    executable: configuredValue(cli.cuttledocPath, config.cuttledocPath),
    language: configuredValue(cli.transcriptionLanguage, config.transcriptionLanguage),
    backend: configuredValue(cli.transcriptionBackend, config.transcriptionBackend),
    enhancement,
  };
}

export async function inspectCuttledocVersion(
  options: Pick<CuttledocProcessOptions, "executable">,
  runner: CuttledocProcessRunner = defaultRunner
): Promise<string> {
  const output = await runCuttledocProcess(options.executable, ["--version"], runner);
  const match = /^cuttledoc\s+(\S+)\s*$/u.exec(output.stdout);
  if (!match?.[1]) {
    throw new CuttledocCliError(
      "Cuttledoc returned an unrecognized version response",
      "CUTTLEDOC_VERSION_INVALID"
    );
  }
  return match[1];
}

export async function transcribeWithCuttledoc(
  inputPath: string,
  options: CuttledocProcessOptions,
  runner: CuttledocProcessRunner = defaultRunner
): Promise<CuttledocTranscriptionRun> {
  const arguments_ = [
    "transcribe",
    inputPath,
    "--language",
    options.language,
    "--backend",
    options.backend,
    "--enhance",
    options.enhancement,
    "--format",
    "json",
    "--progress",
  ];
  const startedAt = performance.now();
  let paddingMs = 0;
  let output: CuttledocProcessOutput;
  try {
    output = await runCuttledocProcess(options.executable, arguments_, runner);
  } catch (error) {
    // Apple Speech can emit a zero-duration final word when speech reaches EOF.
    // Give it audio context beyond EOF, while keeping the original media intact.
    const range =
      error instanceof CuttledocCliError && error.code === "BACKEND_CONTRACT_VIOLATION"
        ? /segment \d+ has invalid range (\d+)\.\.(\d+)/u.exec(error.message)
        : null;
    if (options.backend !== "apple-speech" || !range || range[1] !== range[2]) throw error;
    paddingMs = 2000;
    output = await withTrailingSilence(inputPath, paddingMs / 1000, (paddedPath) =>
      runCuttledocProcess(
        options.executable,
        ["transcribe", paddedPath, ...arguments_.slice(2)],
        runner
      )
    );
  }
  const wallDurationMs = performance.now() - startedAt;

  let decoded: unknown;
  try {
    decoded = JSON.parse(output.stdout);
  } catch {
    throw new CuttledocCliError("Cuttledoc returned invalid JSON", "CUTTLEDOC_OUTPUT_INVALID");
  }

  const result = cuttledocTranscriptionSchema.safeParse(decoded);
  if (!result.success) {
    throw new CuttledocCliError(
      "Cuttledoc returned an unsupported transcription schema",
      "CUTTLEDOC_OUTPUT_INVALID"
    );
  }

  return {
    result:
      paddingMs === 0
        ? result.data
        : {
            ...result.data,
            media_duration_ms: Math.max(0, result.data.media_duration_ms - paddingMs),
            preprocessing: { trailing_silence_ms: paddingMs },
          },
    wallDurationMs,
    progressOutput: output.stderr,
  };
}

async function runCuttledocProcess(
  executable: string,
  arguments_: string[],
  runner: CuttledocProcessRunner
): Promise<CuttledocProcessOutput> {
  try {
    return await runner(executable, arguments_);
  } catch (error) {
    const record = asRecord(error);
    const stderr = typeof record?.stderr === "string" ? record.stderr : "";
    const stableCode = /error\[([A-Z0-9_]+)\]/u.exec(stderr)?.[1] ?? "CUTTLEDOC_PROCESS_FAILED";
    const exitCode = typeof record?.exitCode === "number" ? record.exitCode : undefined;
    const diagnostic = boundedDiagnostic(stderr);
    const executableMissing = record?.code === "ENOENT";
    const message = executableMissing
      ? `Cuttledoc executable not found: ${executable}. Install the native Cuttledoc CLI or set cuttledocPath. Use sync --no-transcribe to download only, then rerun sync to add missing transcripts.`
      : diagnostic
        ? `Cuttledoc failed: ${diagnostic}`
        : "Cuttledoc process failed";
    throw new CuttledocCliError(message, stableCode, exitCode);
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function boundedDiagnostic(value: string): string {
  // Progress can fill stderr before the useful error at the end of the stream.
  const errorOffset = value.search(/error\[[A-Z0-9_]+\]/u);
  const diagnostic = errorOffset >= 0 ? value.slice(errorOffset) : value;
  const normalized = diagnostic.trim().replaceAll(/\s+/gu, " ");
  return normalized.length <= 500 ? normalized : `${normalized.slice(0, 497)}...`;
}

function configuredValue(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0 ? fallback : normalized;
}
