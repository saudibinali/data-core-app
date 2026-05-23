/**
 * Unified database URL resolver (CJS mirror for scripts — keep in sync with src/resolve-database-url.ts).
 *
 * Resolution order:
 * 1. process.env.DATABASE_URL (non-empty)
 * 2. data/.platform.json databaseUrl (setup wizard persistence)
 * 3. options.explicitUrl (setup / callers)
 * 4. throw if still unresolved
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function getPlatformConfigPath() {
  const dataDir = process.env.PLATFORM_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dataDir, ".platform.json");
}

function readPlatformConfigDatabaseUrl() {
  const configPath = getPlatformConfigPath();
  try {
    if (!fs.existsSync(configPath)) return null;
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    const url = typeof parsed.databaseUrl === "string" ? parsed.databaseUrl.trim() : "";
    return url || null;
  } catch {
    return null;
  }
}

function readEnvDatabaseUrl() {
  const url = typeof process.env.DATABASE_URL === "string" ? process.env.DATABASE_URL.trim() : "";
  return url || null;
}

/**
 * @param {{ explicitUrl?: string }} [options]
 * @returns {{ url: string, source: 'env' | 'platform_config' | 'explicit' } | null}
 */
function tryResolveDatabaseUrl(options) {
  const explicit = options?.explicitUrl?.trim();
  if (explicit) {
    return { url: explicit, source: "explicit" };
  }

  const fromEnv = readEnvDatabaseUrl();
  if (fromEnv) {
    return { url: fromEnv, source: "env" };
  }

  const fromPlatform = readPlatformConfigDatabaseUrl();
  if (fromPlatform) {
    return { url: fromPlatform, source: "platform_config" };
  }

  return null;
}

/**
 * @param {{ explicitUrl?: string }} [options]
 * @returns {string}
 */
function resolveDatabaseUrl(options) {
  const resolved = tryResolveDatabaseUrl(options);
  if (resolved) {
    return resolved.url;
  }

  throw new Error(
    "Database URL could not be resolved. " +
      "Set DATABASE_URL, configure data/.platform.json via the setup wizard, " +
      "or pass explicitUrl to resolveDatabaseUrl().",
  );
}

module.exports = {
  getPlatformConfigPath,
  readPlatformConfigDatabaseUrl,
  tryResolveDatabaseUrl,
  resolveDatabaseUrl,
};
