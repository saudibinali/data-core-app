/**
 * F1 — Production security configuration (JWT, strict mode).
 */

export const DEFAULT_JWT_SECRET = "dev-secret-change-in-production";

const WEAK_JWT_SECRETS = new Set([
  DEFAULT_JWT_SECRET,
  "change-me-to-a-long-random-string-in-production",
  "changeme",
  "secret",
]);

export const JWT_SECRET = process.env.JWT_SECRET ?? DEFAULT_JWT_SECRET;
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? "24h";

/** When false, rate limits / strict CORS / strict webhooks are relaxed (rollback flag). */
export function isSecurityStrict(): boolean {
  return process.env.SECURITY_STRICT !== "false";
}

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

export function isWeakJwtSecret(secret: string | undefined): boolean {
  if (!secret || secret.trim().length < 32) return true;
  return WEAK_JWT_SECRETS.has(secret.trim());
}

/** Fail fast before accepting traffic in production with an insecure JWT secret. */
export function assertProductionSecrets(): void {
  if (!isProductionRuntime()) return;

  if (isWeakJwtSecret(process.env.JWT_SECRET)) {
    throw new Error(
      "JWT_SECRET must be set to a strong random value (≥32 chars) in production. " +
        "Generate one with: openssl rand -hex 64",
    );
  }
}
