/**
 * Phase 6 — Enterprise entity creation on confirm (uses existing transaction patterns).
 */

import {
  db,
  hrJobTitlesTable,
  hrJobGradesTable,
  hrWorkLocationsTable,
  hrPositionsTable,
  hrOrgUnitsTable,
  hrEmploymentTypesTable,
  hrEmployeeStatusesTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { canonicalSlug, uniquifyRuntimeCode } from "../normalization";
import { masterDataCatalogService } from "../catalog/master-data-catalog";
import { recordWorkforceAudit } from "../../workforce/operations/audit-service";
import { incrementRuntimeMetric } from "../../workforce/stabilization/observability-metrics";
import type { EnterprisePolicyProfile } from "./enterprise-runtime-activation";

export type EntityCreateResult = {
  entityType: string;
  name: string;
  entityId: number;
  created: boolean;
  action: "matched" | "created" | "queued_approval" | "skipped";
};

export async function resolveOrCreateEntity(input: {
  workspaceId: number;
  entityType: string;
  name: string;
  entityId?: number;
  policy?: EnterprisePolicyProfile | null;
  approveCreates?: boolean;
  userId?: number;
}): Promise<EntityCreateResult | null> {
  if (!input.name?.trim()) return null;

  if (input.entityId) {
    return {
      entityType: input.entityType,
      name: input.name,
      entityId: input.entityId,
      created: false,
      action: "matched",
    };
  }

  if (!input.policy || input.policy.autoCreateMode === "disabled") {
    return {
      entityType: input.entityType,
      name: input.name,
      entityId: 0,
      created: false,
      action: "skipped",
    };
  }

  if (input.policy.approvalRequired && !input.approveCreates) {
    return {
      entityType: input.entityType,
      name: input.name,
      entityId: 0,
      created: false,
      action: "queued_approval",
    };
  }

  const catalog = await masterDataCatalogService.loadSnapshot(input.workspaceId, true);
  const taken = new Set<string>();
  const list = catalog.entities[input.entityType as keyof typeof catalog.entities];
  for (const e of list ?? []) {
    if (e.code) taken.add(String(e.code).toLowerCase());
  }
  const code = uniquifyRuntimeCode(canonicalSlug(input.name), taken);
  const name = input.name.trim();

  let entityId = 0;

  switch (input.entityType) {
    case "job_title": {
      const [row] = await db.insert(hrJobTitlesTable).values({ workspaceId: input.workspaceId, name, code }).returning({ id: hrJobTitlesTable.id });
      entityId = row!.id;
      break;
    }
    case "job_grade": {
      const [row] = await db.insert(hrJobGradesTable).values({ workspaceId: input.workspaceId, name, code }).returning({ id: hrJobGradesTable.id });
      entityId = row!.id;
      break;
    }
    case "work_location": {
      const [row] = await db.insert(hrWorkLocationsTable).values({ workspaceId: input.workspaceId, name, code }).returning({ id: hrWorkLocationsTable.id });
      entityId = row!.id;
      break;
    }
    case "position": {
      const [row] = await db.insert(hrPositionsTable).values({ workspaceId: input.workspaceId, title: name, code, status: "vacant" }).returning({ id: hrPositionsTable.id });
      entityId = row!.id;
      break;
    }
    case "org_unit": {
      const [row] = await db.insert(hrOrgUnitsTable).values({ workspaceId: input.workspaceId, name, code, type: "department" }).returning({ id: hrOrgUnitsTable.id });
      entityId = row!.id;
      break;
    }
    case "employment_type": {
      const [row] = await db.insert(hrEmploymentTypesTable).values({ workspaceId: input.workspaceId, name, code: code.replace(/-/g, "_") }).returning({ id: hrEmploymentTypesTable.id });
      entityId = row!.id;
      break;
    }
    case "employee_status": {
      const [row] = await db.insert(hrEmployeeStatusesTable).values({ workspaceId: input.workspaceId, name, code: code.replace(/-/g, "_") }).returning({ id: hrEmployeeStatusesTable.id });
      entityId = row!.id;
      break;
    }
    default:
      return { entityType: input.entityType, name, entityId: 0, created: false, action: "skipped" };
  }

  masterDataCatalogService.invalidateCache(input.workspaceId);
  incrementRuntimeMetric("import.phase6.entity_created");

  void recordWorkforceAudit({
    workspaceId: input.workspaceId,
    entityType: input.entityType,
    entityId,
    action: "enterprise.import.auto_create",
    actorUserId: input.userId,
    afterState: { name, code },
  });

  return { entityType: input.entityType, name, entityId, created: true, action: "created" };
}

export async function resolveEmploymentEnum(input: {
  workspaceId: number;
  entityType: "employment_type" | "employee_status";
  value: string;
  policy?: EnterprisePolicyProfile | null;
  approveCreates?: boolean;
  userId?: number;
}): Promise<{ code: string; created: boolean }> {
  const catalog = await masterDataCatalogService.loadSnapshot(input.workspaceId);
  const entityList = catalog.entities[input.entityType] ?? [];
  const normalized = input.value.trim().toLowerCase();
  const existing = entityList.find(
    (e) => e.code?.toLowerCase() === normalized || e.name.toLowerCase() === normalized,
  );
  if (existing?.code) return { code: existing.code, created: false };

  const created = await resolveOrCreateEntity({
    workspaceId: input.workspaceId,
    entityType: input.entityType,
    name: input.value,
    policy: input.policy,
    approveCreates: input.approveCreates,
    userId: input.userId,
  });

  if (created?.action === "created" && created.entityId) {
    const list = await masterDataCatalogService.loadSnapshot(input.workspaceId);
    const row = (list.entities[input.entityType] ?? []).find((e) => e.id === created.entityId);
    return { code: String(row?.code ?? canonicalSlug(input.value)), created: true };
  }

  return { code: canonicalSlug(input.value).replace(/-/g, "_"), created: false };
}
