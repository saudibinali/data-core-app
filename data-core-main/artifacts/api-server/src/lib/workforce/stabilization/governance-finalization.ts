import { db } from "@workspace/db";
import {
  departmentsTable,
  hrEmployeeLeavesTable,
  hrLeaveMigrationMapTable,
  legacyCutoverSnapshotTable,
  legacyDepartmentOrgMapTable,
  leaveRequestsTable,
} from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getWorkforceCleanupStage } from "./cleanup-staging";
import { getLegacyUsageSummary, hasZeroActiveLegacyTraffic } from "./usage-telemetry";
import { getWorkspaceCutoverModes } from "./runtime-health-service";
import { getLeaveRuntimeMode } from "../../hr/hcm-workspace-settings";
import { getPayrollMigrationReport } from "../../payroll/payroll-migration-service";
import { isPayrollCutoverEnabledForWorkspace } from "../../payroll-cutover-flags";
import { isAttendanceCutoverEnabledForWorkspace } from "../../attendance-cutover-flags";

export type CutoverReadinessCheck = {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
};

async function countUnmappedDepartments(workspaceId: number): Promise<number> {
  const rows = await db
    .select({ id: departmentsTable.id })
    .from(departmentsTable)
    .leftJoin(
      legacyDepartmentOrgMapTable,
      and(
        eq(legacyDepartmentOrgMapTable.workspaceId, departmentsTable.workspaceId),
        eq(legacyDepartmentOrgMapTable.departmentId, departmentsTable.id),
      ),
    )
    .where(
      and(
        eq(departmentsTable.workspaceId, workspaceId),
        isNull(legacyDepartmentOrgMapTable.orgUnitId),
      ),
    );
  return rows.length;
}

async function countUnmigratedActiveLegacyLeaves(workspaceId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(hrEmployeeLeavesTable)
    .leftJoin(
      hrLeaveMigrationMapTable,
      and(
        eq(hrLeaveMigrationMapTable.workspaceId, hrEmployeeLeavesTable.workspaceId),
        eq(hrLeaveMigrationMapTable.legacyLeaveId, hrEmployeeLeavesTable.id),
      ),
    )
    .where(
      and(
        eq(hrEmployeeLeavesTable.workspaceId, workspaceId),
        sql`${hrEmployeeLeavesTable.status} IN ('pending', 'approved')`,
        isNull(hrLeaveMigrationMapTable.canonicalRequestId),
      ),
    );
  return row?.count ?? 0;
}

export async function getGovernanceCutoverReadiness(workspaceId: number): Promise<{
  readyForActiveGovernance: boolean;
  readyForCleanupStage1: boolean;
  readyForCanonicalEmployeeImport: boolean;
  readyForCanonicalMasterDataImport: boolean;
  importCommitAllowed: boolean;
  checks: CutoverReadinessCheck[];
}> {
  const modes = await getWorkspaceCutoverModes(workspaceId);
  const usage = await getLegacyUsageSummary(workspaceId, 30);
  const zeroTraffic = await hasZeroActiveLegacyTraffic(workspaceId, 30);
  const stage = await getWorkforceCleanupStage(workspaceId);
  const unmappedDepartments = await countUnmappedDepartments(workspaceId);
  const unmigratedLegacyLeaves = await countUnmigratedActiveLegacyLeaves(workspaceId);
  const leaveRuntimeMode = await getLeaveRuntimeMode(workspaceId);
  const payrollMigration = await getPayrollMigrationReport(workspaceId);
  const payrollCanonicalPilot = isPayrollCutoverEnabledForWorkspace(
    "payrollCanonicalWrite",
    workspaceId,
  );
  const attendanceCanonicalPilot = isAttendanceCutoverEnabledForWorkspace(
    "attendanceCanonicalWrite",
    workspaceId,
  );
  const [canonicalPending] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(leaveRequestsTable)
    .where(
      and(
        eq(leaveRequestsTable.workspaceId, workspaceId),
        sql`${leaveRequestsTable.status} IN ('pending', 'pending_approval')`,
      ),
    );

  const checks: CutoverReadinessCheck[] = [
    {
      id: "org_active",
      label: "Org runtime active",
      passed: modes.orgRuntimeMode === "active",
      detail: `orgRuntimeMode=${modes.orgRuntimeMode}`,
    },
    {
      id: "approval_unified_or_dual",
      label: "Approval runtime dual/unified",
      passed: modes.approvalRuntimeMode === "dual" || modes.approvalRuntimeMode === "unified",
      detail: `approvalRuntimeMode=${modes.approvalRuntimeMode}`,
    },
    {
      id: "governance_shadow_or_active",
      label: "Governance shadow/active",
      passed: modes.workforceGovernanceMode === "shadow" || modes.workforceGovernanceMode === "active",
      detail: `workforceGovernanceMode=${modes.workforceGovernanceMode}`,
    },
    {
      id: "zero_legacy_traffic_30d",
      label: "Zero legacy route/adapter writes (30d)",
      passed: zeroTraffic,
      detail: `totalEvents=${usage.total}`,
    },
    {
      id: "cleanup_stage_none",
      label: "Cleanup not started (safe baseline)",
      passed: stage === "none",
      detail: `workforceCleanupStage=${stage}`,
    },
    {
      id: "departments_org_mapped",
      label: "All legacy departments mapped to org units",
      passed: unmappedDepartments === 0,
      detail: `unmappedDepartments=${unmappedDepartments}`,
    },
    {
      id: "leave_runtime_canonical_or_transition",
      label: "Leave runtime in transition or canonical",
      passed: leaveRuntimeMode === "transition" || leaveRuntimeMode === "canonical",
      detail: `leaveRuntimeMode=${leaveRuntimeMode}`,
    },
    {
      id: "legacy_leaves_migrated",
      label: "No active legacy leaves without canonical map",
      passed: unmigratedLegacyLeaves === 0,
      detail: `unmigratedActiveLegacyLeaves=${unmigratedLegacyLeaves}`,
    },
    {
      id: "canonical_leave_queue",
      label: "Canonical leave queue tracked",
      passed: true,
      detail: `pendingCanonicalRequests=${canonicalPending?.count ?? 0}`,
    },
    {
      id: "payroll_legacy_migrated",
      label: "Legacy payroll runs migrated to canonical",
      passed: payrollMigration.pendingMigration === 0,
      detail: `pendingMigration=${payrollMigration.pendingMigration} legacyTotal=${payrollMigration.legacyTotal}`,
    },
    {
      id: "payroll_canonical_pilot",
      label: "Payroll canonical write enabled (pilot)",
      passed: !payrollCanonicalPilot || payrollMigration.pendingMigration === 0,
      detail: `payrollCanonicalWrite=${payrollCanonicalPilot} pending=${payrollMigration.pendingMigration}`,
    },
    {
      id: "attendance_canonical_pilot",
      label: "Attendance canonical write enabled (pilot)",
      passed: true,
      detail: `attendanceCanonicalWrite=${attendanceCanonicalPilot} importPath=POST /hr/workforce/imports`,
    },
    {
      id: "attendance_workforce_import",
      label: "Use workforce import for canonical attendance (when pilot)",
      passed: true,
      detail: `attendanceCanonicalWrite=${attendanceCanonicalPilot} path=POST /hr/workforce/imports`,
    },
  ];

  const importCommitAllowedPrecheck =
    (modes.orgRuntimeMode !== "active" && leaveRuntimeMode !== "canonical")
    || (unmappedDepartments === 0 && unmigratedLegacyLeaves === 0);

  checks.push({
    id: "import_commit_ready",
    label: "HR import v2 commit allowed (canonical gates)",
    passed: importCommitAllowedPrecheck,
    detail: `org=${modes.orgRuntimeMode} leave=${leaveRuntimeMode} unmappedDept=${unmappedDepartments} unmigratedLeave=${unmigratedLegacyLeaves}`,
  });

  const readyForActiveGovernance =
    modes.orgRuntimeMode === "active"
    && (modes.approvalRuntimeMode === "dual" || modes.approvalRuntimeMode === "unified")
    && modes.workforceGovernanceMode !== "legacy";

  const readyForCleanupStage1 =
    readyForActiveGovernance
    && zeroTraffic
    && stage === "none";

  const readyForCanonicalEmployeeImport =
    (modes.orgRuntimeMode !== "active" || unmappedDepartments === 0)
    && (leaveRuntimeMode !== "canonical" || unmigratedLegacyLeaves === 0);

  const readyForCanonicalMasterDataImport =
    modes.orgRuntimeMode !== "active" || unmappedDepartments === 0;

  const importCommitAllowed = importCommitAllowedPrecheck;

  return {
    readyForActiveGovernance,
    readyForCleanupStage1,
    readyForCanonicalEmployeeImport,
    readyForCanonicalMasterDataImport,
    importCommitAllowed,
    checks,
  };
}

export async function upsertDailyCutoverSnapshot(workspaceId: number): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const modes = await getWorkspaceCutoverModes(workspaceId);
  const usage = await getLegacyUsageSummary(workspaceId, 1);
  const stage = await getWorkforceCleanupStage(workspaceId);

  await db
    .insert(legacyCutoverSnapshotTable)
    .values({
      workspaceId,
      snapshotDate: today,
      modes,
      legacyHits: usage.bySurface,
      cleanupStage: stage,
      integrity: { zeroActiveLegacyTraffic: usage.total === 0 },
    })
    .onConflictDoUpdate({
      target: [legacyCutoverSnapshotTable.workspaceId, legacyCutoverSnapshotTable.snapshotDate],
      set: {
        modes,
        legacyHits: usage.bySurface,
        cleanupStage: stage,
        integrity: { zeroActiveLegacyTraffic: usage.total === 0 },
      },
    })
    .catch(() => undefined);
}
