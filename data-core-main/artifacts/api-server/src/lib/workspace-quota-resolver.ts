/**
 * @file   workspace-quota-resolver.ts
 * @phase  P16-C - Workspace Limits & Quotas
 *
 * Read-only usage resolution. No mutations, blocks, or enforcement.
 */

import { db } from "@workspace/db";
import {
  workspaceQuotaLimitsTable,
  usersTable,
  employeesTable,
  hrOrgUnitsTable,
  hrEmployeeDocumentsTable,
  workflowDefinitionsTable,
  workspaceCustomRolesTable,
} from "@workspace/db";
import { eq, and, isNull, count, sql } from "drizzle-orm";
import {
  QUOTA_CATALOG,
  getQuotaCatalogEntry,
  type QuotaCatalogEntry,
} from "./workspace-quota-catalog";

export type QuotaUsageStatus = "ok" | "warning" | "exceeded" | "unlimited" | "unknown";

export interface ResolvedQuotaUsageItem {
  quotaKey: string;
  label: string;
  labelAr: string;
  unit: string;
  limitValue: number | null;
  currentUsage: number | null;
  usagePercent: number | null;
  status: QuotaUsageStatus;
  warningThresholdPercent: number;
  isHardLimit: boolean;
  source: string | null;
  quotaLimitId: number | null;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
}

function rowAppliesNow(row: {
  effectiveFrom: string | null;
  effectiveUntil: string | null;
}): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (row.effectiveFrom && row.effectiveFrom > today) return false;
  if (row.effectiveUntil && row.effectiveUntil < today) return false;
  return true;
}

function computeStatus(
  limitValue: number | null,
  currentUsage: number | null,
  warningThresholdPercent: number,
): QuotaUsageStatus {
  if (limitValue === null) return "unlimited";
  if (currentUsage === null) return "unknown";
  if (limitValue <= 0) {
    return currentUsage > 0 ? "exceeded" : "ok";
  }
  const pct = (currentUsage / limitValue) * 100;
  if (pct >= 100) return "exceeded";
  if (pct >= warningThresholdPercent) return "warning";
  return "ok";
}

function usagePercent(limitValue: number | null, currentUsage: number | null): number | null {
  if (limitValue === null || currentUsage === null) return null;
  if (limitValue <= 0) return currentUsage > 0 ? 100 : 0;
  return Math.round((currentUsage / limitValue) * 1000) / 10;
}

async function measureUsage(
  workspaceId: number,
  quotaKey: string,
): Promise<number | null> {
  switch (quotaKey) {
    case "users.max": {
      const [row] = await db
        .select({ n: count() })
        .from(usersTable)
        .where(eq(usersTable.workspaceId, workspaceId));
      return Number(row?.n ?? 0);
    }
    case "employees.max": {
      const [row] = await db
        .select({ n: count() })
        .from(employeesTable)
        .where(eq(employeesTable.workspaceId, workspaceId));
      return Number(row?.n ?? 0);
    }
    case "branches.max": {
      const [row] = await db
        .select({ n: count() })
        .from(hrOrgUnitsTable)
        .where(
          and(eq(hrOrgUnitsTable.workspaceId, workspaceId), eq(hrOrgUnitsTable.type, "branch")),
        );
      return Number(row?.n ?? 0);
    }
    case "documents.max": {
      const [row] = await db
        .select({ n: count() })
        .from(hrEmployeeDocumentsTable)
        .where(eq(hrEmployeeDocumentsTable.workspaceId, workspaceId));
      return Number(row?.n ?? 0);
    }
    case "storage.gb": {
      const [row] = await db
        .select({
          bytes: sql<number>`coalesce(sum(${hrEmployeeDocumentsTable.fileSize}), 0)`,
        })
        .from(hrEmployeeDocumentsTable)
        .where(eq(hrEmployeeDocumentsTable.workspaceId, workspaceId));
      const bytes = Number(row?.bytes ?? 0);
      if (bytes === 0) return 0;
      return Math.round((bytes / (1024 * 1024 * 1024)) * 100) / 100;
    }
    case "workflows.max": {
      const [row] = await db
        .select({ n: count() })
        .from(workflowDefinitionsTable)
        .where(
          and(
            eq(workflowDefinitionsTable.workspaceId, workspaceId),
            isNull(workflowDefinitionsTable.deletedAt),
          ),
        );
      return Number(row?.n ?? 0);
    }
    case "custom.roles.max": {
      const [row] = await db
        .select({ n: count() })
        .from(workspaceCustomRolesTable)
        .where(eq(workspaceCustomRolesTable.workspaceId, workspaceId));
      return Number(row?.n ?? 0);
    }
    case "integrations.max":
    case "api.requests.monthly":
    case "ai.actions.monthly":
    case "reports.max":
      return null;
    default:
      return null;
  }
}

export async function resolveWorkspaceQuotaUsage(
  workspaceId: number,
): Promise<ResolvedQuotaUsageItem[]> {
  const limitRows = await db
    .select()
    .from(workspaceQuotaLimitsTable)
    .where(eq(workspaceQuotaLimitsTable.workspaceId, workspaceId));

  const activeLimits = limitRows.filter(rowAppliesNow);

  const results: ResolvedQuotaUsageItem[] = [];

  for (const catalogEntry of QUOTA_CATALOG) {
    const limitRow = activeLimits.find((r) => r.quotaKey === catalogEntry.key);
    const catalog = getQuotaCatalogEntry(catalogEntry.key) as QuotaCatalogEntry;

    const effectiveLimit: number | null = limitRow
      ? limitRow.limitValue
      : catalog.defaultLimit;

    const warningThresholdPercent =
      limitRow?.warningThresholdPercent ?? catalog.warningThresholdPercent;

    const isHardLimit = limitRow?.isHardLimit ?? false;
    const source = limitRow?.source ?? "system_default";

    const currentUsage = await measureUsage(workspaceId, catalogEntry.key);

    const status = computeStatus(effectiveLimit, currentUsage, warningThresholdPercent);

    results.push({
      quotaKey: catalogEntry.key,
      label: catalog.label,
      labelAr: catalog.labelAr,
      unit: catalog.unit,
      limitValue: effectiveLimit,
      currentUsage,
      usagePercent: usagePercent(effectiveLimit, currentUsage),
      status,
      warningThresholdPercent,
      isHardLimit,
      source,
      quotaLimitId: limitRow?.id ?? null,
      effectiveFrom: limitRow?.effectiveFrom ?? null,
      effectiveUntil: limitRow?.effectiveUntil ?? null,
    });
  }

  return results;
}
