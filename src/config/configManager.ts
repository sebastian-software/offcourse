import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { APP_DIR, CONFIG_FILE, SESSIONS_DIR } from "./paths.js";
import { Config, configSchema } from "./schema.js";

/**
 * Ensures all required application directories exist.
 */
export function ensureAppDirectories(): void {
  const dirs = [APP_DIR, SESSIONS_DIR, `${APP_DIR}/sync-state`];

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * Loads the application configuration from disk.
 * Returns default config if file doesn't exist.
 */
export function loadConfig(): Config {
  ensureAppDirectories();

  if (!existsSync(CONFIG_FILE)) {
    const defaultConfig = configSchema.parse({});
    saveConfig(defaultConfig);
    return defaultConfig;
  }

  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return configSchema.parse(parsed);
  } catch (error) {
    console.error("Failed to parse config, using defaults:", error);
    return configSchema.parse({});
  }
}

/**
 * Saves the configuration to disk.
 */
export function saveConfig(config: Config): void {
  ensureAppDirectories();

  const dir = dirname(CONFIG_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Updates specific config values.
 */
export function updateConfig(updates: Partial<Config>): Config {
  const current = loadConfig();
  const updated = configSchema.parse({ ...current, ...updates });
  saveConfig(updated);
  return updated;
}

/**
 * Gets a specific config value.
 */
export function getConfigValue<K extends keyof Config>(key: K): Config[K] {
  const config = loadConfig();
  return config[key];
}

