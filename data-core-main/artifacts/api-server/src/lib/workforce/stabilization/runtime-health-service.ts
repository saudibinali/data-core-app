import type pg from "pg";
import { db } from "@workspace/db";
import {
  hrWorkspaceSettingsTable,
  runtimeSchemaRegistryTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { getLegacyAuditReport } from "./legacy-audit-inventory";
import { getLegacyUsageSummary } from "./usage-telemetry";
import { getWorkforceCleanupStage } from "./cleanup-staging";
import { getRuntimeMetrics, getStartupDiagnostics } from "./observability-metrics";
import { getLeaveCutoverMetrics } from "../../leave-cutover-metrics";

export const RUNTIME_MIGRATION_TARGETS = {
  workforce_canonical: "0024_workforce_canonical_foundation",
  org_runtime: "0025_org_runtime_foundation",
  approval_runtime: "0026_approval_runtime_foundation",
  workforce_operations: "0027_workforce_operations_foundation",
  legacy_compat: "0028_legacy_compat_stabilization",
  hr_import_runtime: "0029_hr_import_runtime_foundation",
} as const;

export async function updateSchemaRegistryStatus(
  component: keyof typeof RUNTIME_MIGRATION_TARGETS,
  status: "ok" | "missing" | "error",
  details?: unknown,
): Promise<void> {
  await db
    .insert(runtimeSchemaRegistryTable)
    .values({
      component,
      expectedMigration: RUNTIME_MIGRATION_TARGETS[component],
      verifiedAt: new Date(),
      status,
      details: details ?? null,
    })
    .onConflictDoUpdate({
      target: runtimeSchemaRegistryTable.component,
      set: {
        verifiedAt: new Date(),
        status,
        details: details ?? null,
      },
    })
    .catch(() => undefined);
}

export async function getSchemaRegistrySnapshot() {
  const rows = await db.select().from(runtimeSchemaRegistryTable);
  const byComponent = Object.fromEntries(rows.map((r) => [r.component, r]));
  const missing = Object.keys(RUNTIME_MIGRATION_TARGETS).filter(
    (k) => byComponent[k]?.status !== "ok",
  );
  return { components: byComponent, missing, allOk: missing.length === 0 };
}

export async function getWorkspaceCutoverModes(workspaceId: number) {
  const [row] = await db
    .select()
    .from(hrWorkspaceSettingsTable)
    .where(eq(hrWorkspaceSettingsTable.workspaceId, workspaceId));

  return {
    leaveRuntimeMode: row?.leaveRuntimeMode ?? "transition",
    workforceCanonicalMode: row?.workforceCanonicalMode ?? "legacy",
    workforceSyncDirection: row?.workforceSyncDirection ?? "none",
    orgRuntimeMode: row?.orgRuntimeMode ?? "legacy",
    approvalRuntimeMode: row?.approvalRuntimeMode ?? "legacy",
    workforceGovernanceMode: row?.workforceGovernanceMode ?? "legacy",
    workforceCleanupStage: row?.workforceCleanupStage ?? "none",
    employeeImportRuntimeMode: row?.employeeImportRuntimeMode ?? "legacy",
    masterDataRuntimeMode: row?.masterDataRuntimeMode ?? "legacy",
    importValidationMode: row?.importValidationMode ?? "warn",
  };
}

export async function getWorkforceRuntimeHealth(workspaceId?: number) {
  const schema = await getSchemaRegistrySnapshot();
  const audit = getLegacyAuditReport();
  const metrics = getRuntimeMetrics();
  const startupDiagnostics = getStartupDiagnostics();
  const leaveMetrics = getLeaveCutoverMetrics();

  let usage = null;
  let modes = null;
  let cleanupStage = "none";
  let zeroLegacyTraffic = null;

  if (workspaceId != null) {
    usage = await getLegacyUsageSummary(workspaceId, 30);
    modes = await getWorkspaceCutoverModes(workspaceId);
    cleanupStage = await getWorkforceCleanupStage(workspaceId);
    zeroLegacyTraffic = usage.total === 0;
  }

  return {
    status: schema.allOk ? "healthy" : "degraded",
    schema,
    migrationTargets: RUNTIME_MIGRATION_TARGETS,
    auditSummary: {
      totalLegacySurfaces: audit.totalSurfaces,
      rules: audit.rules,
    },
    workspace: workspaceId != null
      ? { id: workspaceId, modes, cleanupStage, usage, zeroLegacyTraffic30d: zeroLegacyTraffic }
      : null,
    metrics: { runtime: metrics, leave: leaveMetrics },
    startupDiagnostics,
    migrationHint: schema.allOk
      ? null
      : "Run pending migration scripts and restart api-server to verify schema registry",
  };
}

export async function verifyTableExists(pool: pg.Pool | pg.PoolClient, table: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1 LIMIT 1`,
    [table],
  );
  return rows.length > 0;
}
