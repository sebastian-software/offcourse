import chalk from "chalk";
import { getConfigValue, loadConfig, updateConfig } from "../../config/configManager.js";
import { CONFIG_FILE } from "../../config/paths.js";
import type { Config } from "../../config/schema.js";
import { configSchema } from "../../config/schema.js";

/**
 * Shows all current configuration values.
 */
export function configShowCommand(): void {
  const config = loadConfig();

  console.log(chalk.blue("\n⚙️  Configuration\n"));
  console.log(chalk.gray(`   File: ${CONFIG_FILE}\n`));

  for (const [key, value] of Object.entries(config)) {
    console.log(`   ${chalk.cyan(key)}: ${chalk.white(String(value))}`);
  }
  console.log();
}

/**
 * Sets a configuration value.
 */
export function configSetCommand(key: string, value: string): void {
  const validKeys = Object.keys(configSchema.shape) as (keyof Config)[];

  if (!validKeys.includes(key as keyof Config)) {
    console.log(chalk.red(`\n❌ Unknown config key: ${key}`));
    console.log(chalk.gray(`   Valid keys: ${validKeys.join(", ")}\n`));
    process.exit(1);
  }

  // Parse value based on expected type
  const currentValue = getConfigValue(key as keyof Config);
  let parsedValue: string | number | boolean;

  if (typeof currentValue === "boolean") {
    parsedValue = value === "true" || value === "1";
  } else if (typeof currentValue === "number") {
    parsedValue = parseInt(value, 10);
    if (isNaN(parsedValue)) {
      console.log(chalk.red(`\n❌ Invalid number: ${value}\n`));
      process.exit(1);
    }
  } else {
    parsedValue = value;
  }

  try {
    updateConfig({ [key]: parsedValue });
    console.log(chalk.green(`\n✅ Set ${key} = ${parsedValue}\n`));
  } catch (error) {
    console.log(chalk.red(`\n❌ Invalid value for ${key}: ${value}`));
    console.log(chalk.gray(`   ${String(error)}\n`));
    process.exit(1);
  }
}

/**
 * Gets a specific configuration value.
 */
export function configGetCommand(key: string): void {
  const validKeys = Object.keys(configSchema.shape) as (keyof Config)[];

  if (!validKeys.includes(key as keyof Config)) {
    console.log(chalk.red(`\n❌ Unknown config key: ${key}`));
    console.log(chalk.gray(`   Valid keys: ${validKeys.join(", ")}\n`));
    process.exit(1);
  }

  const value = getConfigValue(key as keyof Config);
  console.log(String(value));
}
