/**
 * Phase 5 — Master data policy registry service.
 */

import { db, hrMasterDataRegistryTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { CatalogEntityType } from "../catalog/master-data-catalog";

export type AutoCreateMode = "disabled" | "controlled" | "pilot_only";
export type DuplicateStrategy = "reject" | "skip" | "queue_review";
export type ReconciliationMode = "report_only" | "suggest" | "disabled";

export type EntityPolicy = {
  entityType: string;
  autoCreatePolicy: string;
  autoCreateMode: AutoCreateMode;
  approvalRequired: boolean;
  canonicalStrategy: string;
  duplicateStrategy: DuplicateStrategy;
  reconciliationMode: ReconciliationMode;
  isRuntimeSensitive: boolean;
  autoCreateAllowed: boolean;
};

/** Entity types eligible for controlled auto-create in Phase 5. */
export const AUTO_CREATE_ELIGIBLE: CatalogEntityType[] = [
  "job_title",
  "job_grade",
  "work_location",
  "document_type",
];

export const AUTO_CREATE_BLOCKED: CatalogEntityType[] = [
  "org_unit",
  "employee_status",
  "employment_type",
  "contract_type",
  "leave_policy",
  "probation_policy",
];

function normalizeAutoCreateMode(value: unknown): AutoCreateMode {
  if (value === "controlled" || value === "pilot_only") return value;
  return "disabled";
}

export async function loadWorkspacePolicies(workspaceId: number): Promise<EntityPolicy[]> {
  const rows = await db
    .select()
    .from(hrMasterDataRegistryTable)
    .where(eq(hrMasterDataRegistryTable.workspaceId, workspaceId));

  return rows.map((row) => {
    const entityType = row.entityType;
    const blocked = AUTO_CREATE_BLOCKED.includes(entityType as CatalogEntityType);
    const eligible = AUTO_CREATE_ELIGIBLE.includes(entityType as CatalogEntityType);
    const mode = normalizeAutoCreateMode(row.autoCreateMode ?? row.autoCreatePolicy);

    return {
      entityType,
      autoCreatePolicy: row.autoCreatePolicy,
      autoCreateMode: blocked ? "disabled" : mode,
      approvalRequired: row.approvalRequired ?? true,
      canonicalStrategy: row.canonicalStrategy ?? "slug_from_name",
      duplicateStrategy: (row.duplicateStrategy ?? "reject") as DuplicateStrategy,
      reconciliationMode: (row.reconciliationMode ?? "report_only") as ReconciliationMode,
      isRuntimeSensitive: row.isRuntimeSensitive,
      autoCreateAllowed: eligible && !blocked && mode !== "disabled",
    };
  });
}

export async function getEntityPolicy(
  workspaceId: number,
  entityType: string,
): Promise<EntityPolicy | null> {
  const policies = await loadWorkspacePolicies(workspaceId);
  return policies.find((p) => p.entityType === entityType) ?? null;
}

export function resolvePolicyForPilot(policy: EntityPolicy, pilotEnabled: boolean): EntityPolicy {
  if (policy.autoCreateMode === "pilot_only" && !pilotEnabled) {
    return { ...policy, autoCreateAllowed: false };
  }
  if (policy.autoCreateMode === "controlled" && pilotEnabled) {
    return { ...policy, autoCreateAllowed: policy.autoCreateAllowed };
  }
  return policy;
}
