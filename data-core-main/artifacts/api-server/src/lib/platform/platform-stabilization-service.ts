/**
 * HCM workspace infrastructure readiness snapshot (no mutations).
 */
import { db } from "@workspace/db";
import {
  platformModulesTable,
  workspaceModuleSettingsTable,
  leaveRequestsTable,
  hrEmployeeLeavesTable,
  payrollRunsTable,
  hrPayrollRunsTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { MODULE_DEPENDENCIES } from "./module-governance-service";
import { infrastructureCutoverStatus } from "./infrastructure-cutover";
import { getLeaveCutoverMetrics } from "../leave-cutover-metrics";
import { getLeaveMigrationReport } from "../hr/leave-migration-service";
import { getPayrollMigrationReport } from "../payroll/payroll-migration-service";

const LATEST_MIGRATION = "0022_hcm_drop_erp_domains";

export class PlatformStabilizationService {
  async workspaceSnapshot(workspaceId: number) {
    const [modules, enabledRows, leaveCanonical, leaveLegacy, payrollCanonical, payrollLegacy] =
      await Promise.all([
        db.select().from(platformModulesTable).orderBy(platformModulesTable.displayOrder),
        db
          .select({ moduleKey: workspaceModuleSettingsTable.moduleKey, enabled: workspaceModuleSettingsTable.enabled })
          .from(workspaceModuleSettingsTable)
          .where(eq(workspaceModuleSettingsTable.workspaceId, workspaceId)),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(leaveRequestsTable)
          .where(eq(leaveRequestsTable.workspaceId, workspaceId)),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(hrEmployeeLeavesTable)
          .where(eq(hrEmployeeLeavesTable.workspaceId, workspaceId)),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(payrollRunsTable)
          .where(eq(payrollRunsTable.workspaceId, workspaceId)),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(hrPayrollRunsTable)
          .where(eq(hrPayrollRunsTable.workspaceId, workspaceId)),
      ]);

    const enabledMap = new Map(enabledRows.map((r) => [r.moduleKey, r.enabled]));
    const moduleStates = modules.map((m) => ({
      key: m.key,
      name: m.name,
      navigationPath: m.navigationPath,
      core: m.core,
      defaultEnabled: m.defaultEnabled,
      enabled: m.core ? true : (enabledMap.get(m.key) ?? m.defaultEnabled),
      dependencies: MODULE_DEPENDENCIES[m.key] ?? [],
    }));

    const cutover = infrastructureCutoverStatus(workspaceId);
    const leaveMetrics = getLeaveCutoverMetrics();
    const [leaveMigration, payrollMigration] = await Promise.all([
      getLeaveMigrationReport(workspaceId),
      getPayrollMigrationReport(workspaceId),
    ]);

    const risks: string[] = [];
    if (leaveLegacy[0]!.count > 0 && leaveCanonical[0]!.count > 0) {
      risks.push("dual_leave_models");
    }
    if (payrollLegacy[0]!.count > 0 && payrollCanonical[0]!.count > 0) {
      risks.push("dual_payroll_models");
    }

    return {
      schemaMigrationTag: LATEST_MIGRATION,
      cutover,
      leaveMetrics,
      modules: moduleStates,
      counts: {
        leaveRequestsCanonical: leaveCanonical[0]?.count ?? 0,
        leaveRequestsLegacy: leaveLegacy[0]?.count ?? 0,
        payrollRunsCanonical: payrollCanonical[0]?.count ?? 0,
        payrollRunsLegacy: payrollLegacy[0]?.count ?? 0,
      },
      leaveMigration,
      payrollMigration,
      risks,
      recommendations: this.recommendations(risks, cutover, leaveMigration, payrollMigration),
      generatedAt: new Date().toISOString(),
    };
  }

  private recommendations(
    risks: string[],
    cutover: ReturnType<typeof infrastructureCutoverStatus>,
    leaveMigration: Awaited<ReturnType<typeof getLeaveMigrationReport>>,
    payrollMigration: Awaited<ReturnType<typeof getPayrollMigrationReport>>,
  ) {
    const recs: string[] = [];
    if (risks.includes("dual_leave_models")) {
      recs.push("Run GET /hr/leave-migration/report then POST /hr/leave-migration/run (dryRun first)");
      recs.push("Set leaveRuntimeMode to transition then canonical after migration");
    }
    if (leaveMigration.pendingMigration > 0) {
      recs.push(`${leaveMigration.pendingMigration} legacy leave rows pending migration`);
    }
    if (leaveMigration.skippedNoLinkedUser > 0) {
      recs.push(`Link ${leaveMigration.skippedNoLinkedUser} employees to users before migration`);
    }
    if (risks.includes("dual_payroll_models")) {
      recs.push("POST /hr/payroll-migration/run (dryRun) then enable LEGACY_PAYROLL_FREEZE");
    }
    if (payrollMigration.pendingMigration > 0) {
      recs.push(`${payrollMigration.pendingMigration} legacy payroll runs pending migration`);
    }
    if (!cutover.leave.legacyFreeze && risks.includes("dual_leave_models")) {
      recs.push("Set LEAVE_CUTOVER_PILOT_WORKSPACE_ID + LEGACY_LEAVE_FREEZE=true");
    }
    if (recs.length === 0) {
      recs.push("HCM cutover looks clean — continue with payroll operations and HR analytics");
    }
    return recs;
  }
}

export const platformStabilizationService = new PlatformStabilizationService();
