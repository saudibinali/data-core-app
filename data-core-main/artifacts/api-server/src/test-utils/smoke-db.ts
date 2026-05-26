/**
 * Shared gate for DB-backed smoke / integration tests (F0.3).
 * Requires vitest.global-setup.ts to probe DATABASE_URL before workers load.
 */
export function isSmokeDatabaseAvailable(): boolean {
  if (process.env.SMOKE_DB_REACHABLE === "0") return false;
  if (process.env.SMOKE_DB_REACHABLE === "1") return true;
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function smokeRunEnabled(optOutEnvVar?: string): boolean {
  if (optOutEnvVar && process.env[optOutEnvVar] === "0") return false;
  return isSmokeDatabaseAvailable();
}

export function postDeploySmokeEnabled(): boolean {
  if (process.env.RUN_POST_DEPLOY_SMOKE !== "1") return false;
  return isSmokeDatabaseAvailable();
}
