/**
 * @file   workspace-entitlement-resolver.ts
 * @phase  P16-B - Entitlement & Feature Access Model
 *
 * Read-only resolution helpers. No login blocking, redirects, or mutations.
 */

import { db } from "@workspace/db";
import { workspaceEntitlementsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  ENTITLEMENT_MODULE_KEYS,
  getFeaturesForModule,
  isCoreModule,
  type EntitlementModuleKey,
} from "./workspace-entitlement-catalog";

export interface ResolvedModuleEntitlement {
  moduleKey: EntitlementModuleKey;
  isEnabled: boolean;
  source: string | null;
  features: Record<string, boolean>;
}

export type ResolvedWorkspaceEntitlements = Record<EntitlementModuleKey, ResolvedModuleEntitlement>;

function normalizeFeatureKey(featureKey: string | null | undefined): string {
  return featureKey?.trim() ? featureKey.trim() : "";
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

export async function resolveWorkspaceEntitlements(
  workspaceId: number,
): Promise<ResolvedWorkspaceEntitlements> {
  const rows = await db
    .select()
    .from(workspaceEntitlementsTable)
    .where(eq(workspaceEntitlementsTable.workspaceId, workspaceId));

  const activeRows = rows.filter(rowAppliesNow);

  const result = {} as ResolvedWorkspaceEntitlements;

  for (const moduleKey of ENTITLEMENT_MODULE_KEYS) {
    const moduleRow = activeRows.find(
      (r) => r.moduleKey === moduleKey && normalizeFeatureKey(r.featureKey) === "",
    );

    const moduleEnabled = isCoreModule(moduleKey)
      ? true
      : moduleRow?.isEnabled ?? false;

    const features: Record<string, boolean> = {};
    for (const feat of getFeaturesForModule(moduleKey)) {
      const featRow = activeRows.find(
        (r) => r.moduleKey === moduleKey && r.featureKey === feat.key,
      );
      if (featRow) {
        features[feat.key] = featRow.isEnabled;
      } else {
        features[feat.key] = moduleEnabled;
      }
    }

    result[moduleKey] = {
      moduleKey,
      isEnabled: moduleEnabled,
      source: moduleRow?.source ?? (isCoreModule(moduleKey) ? "system_default" : null),
      features,
    };
  }

  return result;
}

export async function canWorkspaceUseFeature(
  workspaceId: number,
  moduleKey: string,
  featureKey?: string,
): Promise<boolean> {
  if (isCoreModule(moduleKey)) return true;

  const resolved = await resolveWorkspaceEntitlements(workspaceId);
  const mod = resolved[moduleKey as EntitlementModuleKey];
  if (!mod) return false;

  if (!featureKey) return mod.isEnabled;

  if (featureKey in mod.features) return mod.features[featureKey] ?? false;

  return mod.isEnabled;
}
