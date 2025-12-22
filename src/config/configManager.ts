import Conf from "conf";
import { APP_DIR, SESSIONS_DIR } from "./paths.js";
import { Config, configSchema } from "./schema.js";
import { ensureDir } from "../shared/fs.js";

/**
 * Application configuration store using conf package.
 * Provides atomic writes, dot-notation access, and safe defaults.
 */
const store = new Conf<Config>({
  projectName: "offcourse",
  cwd: APP_DIR,
  configName: "config",
  defaults: configSchema.parse({}),
});

/**
 * Ensures all required application directories exist.
 */
export async function ensureAppDirectories(): Promise<void> {
  const dirs = [APP_DIR, SESSIONS_DIR, `${APP_DIR}/sync-state`];
  await Promise.all(dirs.map((dir) => ensureDir(dir)));
}

/**
 * Loads the application configuration.
 * Returns validated config with defaults applied.
 */
export function loadConfig(): Config {
  // Validate with zod to ensure type safety
  return configSchema.parse(store.store);
}

/**
 * Saves the configuration.
 */
export function saveConfig(config: Config): void {
  const validated = configSchema.parse(config);
  store.store = validated;
}

/**
 * Updates specific config values.
 */
export function updateConfig(updates: Partial<Config>): Config {
  const current = loadConfig();
  const updated = configSchema.parse({ ...current, ...updates });
  store.store = updated;
  return updated;
}

/**
 * Gets a specific config value.
 */
export function getConfigValue<K extends keyof Config>(key: K): Config[K] {
  return store.get(key);
}

/**
 * Clears all configuration (for testing or reset).
 */
export function clearConfig(): void {
  store.clear();
}

/**
 * Gets the path to the config file.
 */
export function getConfigPath(): string {
  return store.path;
}
