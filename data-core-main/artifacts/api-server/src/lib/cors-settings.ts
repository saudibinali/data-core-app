/**
 * F1.4 — CORS origins from platform_settings.network.cors_origins.
 * Production + SECURITY_STRICT: same-origin only when unset (plus APP_URL).
 */

import { db, isDatabaseConfigured, platformSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { isProductionRuntime, isSecurityStrict } from "./security-config";

const REFRESH_MS = 60_000;

let allowedOrigins = new Set<string>();
let refreshTimer: ReturnType<typeof setInterval> | undefined;

function normalizeOrigin(value: string): string {
  try {
    const url = new URL(value.trim());
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return value.trim().toLowerCase().replace(/\/+$/, "");
  }
}

function envFallbackOrigins(): string[] {
  const origins: string[] = [];
  const appUrl = process.env.APP_URL?.trim();
  if (appUrl) origins.push(normalizeOrigin(appUrl));
  return origins;
}

export async function refreshCorsOrigins(): Promise<void> {
  const next = new Set<string>(envFallbackOrigins());

  if (!isDatabaseConfigured()) {
    allowedOrigins = next;
    return;
  }

  try {
    const [row] = await db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.category, "network"))
      .limit(1);

    const stored = (row?.value ?? {}) as Record<string, unknown>;
    const corsOrigins = stored.cors_origins;
    if (Array.isArray(corsOrigins)) {
      for (const entry of corsOrigins) {
        if (typeof entry === "string" && entry.trim()) {
          next.add(normalizeOrigin(entry));
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, "[cors] Failed to load platform cors_origins — using env fallback only");
  }

  allowedOrigins = next;
}

export function startCorsOriginRefresh(): void {
  void refreshCorsOrigins();
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => void refreshCorsOrigins(), REFRESH_MS);
}

export function stopCorsOriginRefreshForTests(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }
}

export function getAllowedCorsOriginsForTests(): Set<string> {
  return new Set(allowedOrigins);
}

export function setAllowedCorsOriginsForTests(origins: string[]): void {
  allowedOrigins = new Set(origins.map(normalizeOrigin));
}

type CorsCallback = (err: Error | null, origin?: boolean | string) => void;

/** Express cors `origin` callback — sync; relies on cached platform settings. */
export function resolveCorsOrigin(requestOrigin: string | undefined, callback: CorsCallback): void {
  if (!isProductionRuntime() || !isSecurityStrict()) {
    callback(null, true);
    return;
  }

  // Same-origin / server-to-server (no Origin header)
  if (!requestOrigin) {
    callback(null, true);
    return;
  }

  const normalized = normalizeOrigin(requestOrigin);
  if (allowedOrigins.size === 0) {
    callback(null, false);
    return;
  }

  if (allowedOrigins.has(normalized)) {
    callback(null, true);
    return;
  }

  callback(null, false);
}
