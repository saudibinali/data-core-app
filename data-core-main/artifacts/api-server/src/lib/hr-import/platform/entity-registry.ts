/**
 * Final Phase — Universal platform entity runtime registry.
 */

import { db, platformEntityRuntimeRegistryTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";

export type PlatformEntityRegistration = {
  entityType: string;
  displayName: string;
  templateKey: string | null;
  validationKey: string | null;
  importEnabled: boolean;
  exportEnabled: boolean;
  rolloutReadiness: string;
  runtimeCompatibility: unknown;
  metadata: unknown;
};

export async function listPlatformEntityRegistry(): Promise<PlatformEntityRegistration[]> {
  const rows = await db
    .select()
    .from(platformEntityRuntimeRegistryTable)
    .orderBy(asc(platformEntityRuntimeRegistryTable.entityType));

  return rows.map((r) => ({
    entityType: r.entityType,
    displayName: r.displayName,
    templateKey: r.templateKey,
    validationKey: r.validationKey,
    importEnabled: r.importEnabled,
    exportEnabled: r.exportEnabled,
    rolloutReadiness: r.rolloutReadiness,
    runtimeCompatibility: r.runtimeCompatibility,
    metadata: r.metadata,
  }));
}

export async function getPlatformEntity(entityType: string): Promise<PlatformEntityRegistration | null> {
  const [row] = await db
    .select()
    .from(platformEntityRuntimeRegistryTable)
    .where(eq(platformEntityRuntimeRegistryTable.entityType, entityType))
    .limit(1);

  if (!row) return null;
  return {
    entityType: row.entityType,
    displayName: row.displayName,
    templateKey: row.templateKey,
    validationKey: row.validationKey,
    importEnabled: row.importEnabled,
    exportEnabled: row.exportEnabled,
    rolloutReadiness: row.rolloutReadiness,
    runtimeCompatibility: row.runtimeCompatibility,
    metadata: row.metadata,
  };
}

export function getFutureEntityStubs(): PlatformEntityRegistration[] {
  return [
    {
      entityType: "platform.dynamic_form",
      displayName: "Dynamic Forms",
      templateKey: null,
      validationKey: null,
      importEnabled: false,
      exportEnabled: false,
      rolloutReadiness: "future",
      runtimeCompatibility: { legacyPreserved: true },
      metadata: { activated: false },
    },
    {
      entityType: "platform.workflow",
      displayName: "Workflow Definitions",
      templateKey: null,
      validationKey: null,
      importEnabled: false,
      exportEnabled: false,
      rolloutReadiness: "future",
      runtimeCompatibility: { legacyPreserved: true },
      metadata: { activated: false },
    },
    {
      entityType: "platform.service_catalog",
      displayName: "Service Catalog",
      templateKey: null,
      validationKey: null,
      importEnabled: false,
      exportEnabled: false,
      rolloutReadiness: "future",
      runtimeCompatibility: { legacyPreserved: true },
      metadata: { activated: false },
    },
    {
      entityType: "platform.asset",
      displayName: "Assets",
      templateKey: null,
      validationKey: null,
      importEnabled: false,
      exportEnabled: false,
      rolloutReadiness: "future",
      runtimeCompatibility: { legacyPreserved: true },
      metadata: { activated: false },
    },
  ];
}
