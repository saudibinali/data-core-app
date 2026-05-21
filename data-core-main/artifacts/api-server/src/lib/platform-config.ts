/**
 * Platform configuration persistence.
 *
 * Stores the DATABASE_URL (and any future platform-level settings) in a JSON
 * file outside the codebase so it survives deployments and restarts.
 *
 * Default location: <cwd>/data/.platform.json
 * Override:         PLATFORM_DATA_DIR environment variable
 *
 * File permissions are set to 600 (owner read/write only) after writing.
 */
import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger";

export interface PlatformConfig {
  databaseUrl?: string;
}

function getConfigPath(): string {
  const dataDir =
    process.env["PLATFORM_DATA_DIR"] ??
    path.join(process.cwd(), "data");
  return path.join(dataDir, ".platform.json");
}

export function loadPlatformConfig(): PlatformConfig {
  const configPath = getConfigPath();
  try {
    if (!fs.existsSync(configPath)) return {};
    const raw = fs.readFileSync(configPath, "utf8");
    return JSON.parse(raw) as PlatformConfig;
  } catch (err) {
    logger.warn({ err, configPath }, "Failed to read platform config - using defaults");
    return {};
  }
}

export function savePlatformConfig(config: PlatformConfig): void {
  const configPath = getConfigPath();
  const dataDir = path.dirname(configPath);

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });

  logger.info({ configPath }, "Platform config saved");
}
