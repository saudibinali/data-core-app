/**
 * @phase P15-H - Tenant-scoped commercial activity feed helpers
 */

import { enrichRow, type RawActivityRow } from "./platform-activity-helpers";

export const COMMERCIAL_ACTIVITY_DEFAULT_LIMIT = 30;
export const COMMERCIAL_ACTIVITY_MAX_LIMIT = 50;

/** Allowed commercial audit action prefixes for tenant feed */
export const COMMERCIAL_ACTIVITY_PREFIXES = [
  "commercial_account_",
  "commercial_billing_contact_",
  "commercial_contract_",
  "commercial_invoice_",
  "commercial_payment_",
  "commercial_risk_",
] as const;

export function isCommercialActivityAction(action: string): boolean {
  return COMMERCIAL_ACTIVITY_PREFIXES.some(p => action.startsWith(p))
    || action === "commercial_access_denied";
}

const SUMMARY_KEYS = [
  "result",
  "reason",
  "tenantId",
  "invoiceId",
  "contractId",
  "paymentId",
  "riskLevel",
  "renewalReadinessStatus",
  "collectionStatus",
  "status",
] as const;

export function buildMetadataSummary(meta: Record<string, unknown> | null): string | null {
  if (!meta) return null;
  const parts: string[] = [];
  for (const key of SUMMARY_KEYS) {
    const v = meta[key];
    if (v === undefined || v === null || v === "") continue;
    if (typeof v === "object") continue;
    parts.push(`${key}: ${String(v)}`);
  }
  if (parts.length === 0) return null;
  const joined = parts.join(" · ");
  return joined.length > 160 ? `${joined.slice(0, 157)}...` : joined;
}

export function toCommercialActivityItem(row: RawActivityRow) {
  const enriched = enrichRow(row);
  return {
    id: enriched.id,
    action: enriched.action,
    actionLabel: enriched.actionLabel,
    actionLabelAr: enriched.actionLabelAr,
    severity: enriched.severity,
    result: enriched.result,
    actorId: enriched.actorId,
    actorDisplayName: enriched.actorDisplayName ?? enriched.actorEmail,
    metadataSummary: buildMetadataSummary(enriched.metadataSafe),
    createdAt: enriched.createdAt,
  };
}

export type CommercialActivityItem = ReturnType<typeof toCommercialActivityItem>;
