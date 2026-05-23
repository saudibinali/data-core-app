/**
 * Unified database URL resolver (TypeScript — bundled with api-server runtime).
 * CJS mirror for scripts: lib/db/resolve-database-url.cjs (keep in sync).
 */
import fs from "node:fs";
import path from "node:path";

export type DatabaseUrlSource = "env" | "platform_config" | "explicit";

export type ResolvedDatabaseUrl = {
  url: string;
  source: DatabaseUrlSource;
};

export function getPlatformConfigPath(): string {
  const dataDir = process.env.PLATFORM_DATA_DIR ?? path.join(process.cwd(), "data");
  return path.join(dataDir, ".platform.json");
}

export function readPlatformConfigDatabaseUrl(): string | null {
  const configPath = getPlatformConfigPath();
  try {
    if (!fs.existsSync(configPath)) return null;
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as { databaseUrl?: string };
    const url = parsed.databaseUrl?.trim();
    return url || null;
  } catch {
    return null;
  }
}

function readEnvDatabaseUrl(): string | null {
  const url = process.env.DATABASE_URL?.trim();
  return url || null;
}

export function tryResolveDatabaseUrl(options?: { explicitUrl?: string }): ResolvedDatabaseUrl | null {
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

export function resolveDatabaseUrl(options?: { explicitUrl?: string }): string {
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
