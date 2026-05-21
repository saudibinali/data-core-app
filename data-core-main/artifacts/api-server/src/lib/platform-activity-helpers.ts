/**
 * platform-activity-helpers.ts
 *
 * @phase P14-E - Platform Administration Users Console Finalization
 *
 * Pure, testable helper functions extracted from platform-activity route.
 * No DB, no HTTP, no side effects - safe for unit testing.
 */

import { getPlatformAuditEventConfig } from "./platform-audit-events";
import { parseAndRedactMetadata } from "./redact-audit-metadata";

// ── Constants ─────────────────────────────────────────────────────────────────

export const PLATFORM_ACTIVITY_DEFAULT_LIMIT      = 50;
export const PLATFORM_ACTIVITY_MAX_LIMIT          = 200;
export const PLATFORM_USER_ACTIVITY_DEFAULT_LIMIT = 20;
export const PLATFORM_USER_ACTIVITY_MAX_LIMIT     = 100;

// ── Query param parsers ───────────────────────────────────────────────────────

/**
 * Parses a limit param.
 * - If raw is a valid positive finite number, clamps to [1, max].
 * - Otherwise returns the default.
 */
export function parseLimit(raw: unknown, def: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(Math.floor(n), max);
}

/**
 * Parses a cursor param (last seen item id for keyset pagination).
 * Returns a positive integer or null.
 */
export function parseCursor(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/**
 * Parses a date param from an ISO string.
 * Returns a Date or null on invalid/missing input.
 */
export function parseDate(raw: unknown): Date | null {
  if (typeof raw !== "string" || !raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ── Row shape ─────────────────────────────────────────────────────────────────

export interface RawActivityRow {
  id: number;
  actorId: number | null;
  actorEmail: string | null;
  actorName: string | null;
  action: string;
  metadata: string | null;
  createdAt: Date;
}

// ── enrichRow ─────────────────────────────────────────────────────────────────

/**
 * Transforms a raw activity_logs row into a safe, enriched API response item.
 *
 * - Looks up event taxonomy for actionLabel/actionLabelAr/group/severity
 * - Falls back safely to unknown-event defaults
 * - Parses and redacts metadata JSON (never returns raw secrets)
 * - Extracts top-level convenience fields from metadata
 */
export function enrichRow(row: RawActivityRow) {
  const cfg      = getPlatformAuditEventConfig(row.action);
  const metaSafe = parseAndRedactMetadata(row.metadata);

  const result        = (metaSafe?.["result"]        as string | undefined) ?? cfg.resultType;
  const reason        = (metaSafe?.["reason"]        as string | undefined) ?? null;
  const blockedReason = (metaSafe?.["blockedReason"] as string | undefined) ?? null;
  const targetUserId  = (metaSafe?.["targetUserId"]  as string | number | undefined) ?? null;
  const targetEmail   = (metaSafe?.["targetEmail"]   as string | undefined) ?? null;
  const targetName    = (metaSafe?.["targetName"]    as string | undefined) ?? null;
  const resourceType  = (metaSafe?.["resourceType"]  as string | undefined) ?? null;
  const resourceId    = (metaSafe?.["resourceId"]    as string | undefined) ?? null;

  return {
    id:               row.id,
    actorId:          row.actorId,
    actorEmail:       row.actorEmail,
    actorDisplayName: row.actorName,
    targetUserId:     targetUserId ? String(targetUserId) : null,
    targetEmail,
    targetDisplayName: targetName,
    action:           row.action,
    actionLabel:      cfg.label,
    actionLabelAr:    cfg.labelAr,
    group:            cfg.group,
    severity:         cfg.severity,
    result,
    reason,
    blockedReason,
    resourceType,
    resourceId,
    metadataSafe:     metaSafe,
    createdAt:        row.createdAt.toISOString(),
  };
}

export type EnrichedActivityRow = ReturnType<typeof enrichRow>;
