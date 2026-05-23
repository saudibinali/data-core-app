/**
 * Final Phase — Universal import/export expansion (registration stubs).
 */

import { listPlatformEntityRegistry, getFutureEntityStubs } from "./entity-registry";
import { HrImportTemplateRegistryV2 } from "../template/template-registry-v2";
import { exportMasterDataJson, exportEmployeesJson } from "../export/export-foundation";

export type UniversalExportRequest = {
  workspaceId: number;
  entityType: string;
  format?: string;
};

export async function runUniversalExport(input: UniversalExportRequest): Promise<unknown> {
  const registry = await listPlatformEntityRegistry();
  const entry = registry.find((e) => e.entityType === input.entityType);

  if (!entry || !entry.exportEnabled) {
    return {
      ok: false,
      reason: "ENTITY_EXPORT_NOT_ACTIVATED",
      entityType: input.entityType,
      futureEntities: getFutureEntityStubs().map((e) => e.entityType),
    };
  }

  switch (input.entityType) {
    case "hr.employee":
      return exportEmployeesJson(input.workspaceId);
    case "hr.master_data":
      return exportMasterDataJson(input.workspaceId);
    default:
      return { ok: false, reason: "NOT_IMPLEMENTED", entityType: input.entityType };
  }
}

export function getUniversalTemplateRegistry() {
  const v2 = HrImportTemplateRegistryV2.list();
  return {
    active: v2.filter((t) => t.status !== "deprecated"),
    legacyPreserved: true,
    futureTemplates: getFutureEntityStubs().map((e) => ({
      entityType: e.entityType,
      templateKey: e.templateKey,
      activated: false,
    })),
  };
}

export function getUniversalValidationRegistry() {
  return {
    hr: ["hr.employee.v2", "hr.master_data.v2"],
    platform: [],
    future: ["platform.dynamic_form", "platform.workflow", "platform.service_catalog", "platform.asset"],
    strictDefaultDisabled: true,
  };
}
