/**
 * HCM workspace go-live gate (HR, leave, payroll cutover — no ERP finance/SCM).
 */
import { getLeaveMigrationReport } from "../hr/leave-migration-service";
import { getLeaveRuntimeMode } from "../hr/hcm-workspace-settings";
import { getPayrollMigrationReport } from "../payroll/payroll-migration-service";
import { moduleGovernanceService } from "./module-governance-service";
import { platformStabilizationService } from "./platform-stabilization-service";
import { infrastructureCutoverStatus } from "./infrastructure-cutover";

export type GoLivePhase = {
  key: string;
  label: string;
  labelAr: string;
  status: "complete" | "pending" | "blocked";
  detail?: string;
};

export type WorkspaceGoLiveSnapshot = {
  hcmGoLiveReady: boolean;
  phases: GoLivePhase[];
  blockers: string[];
  recommendations: string[];
  stabilization: Awaited<ReturnType<typeof platformStabilizationService.workspaceSnapshot>>;
  leaveRuntimeMode: string;
  generatedAt: string;
};

export class WorkspaceGoLiveService {
  async evaluate(workspaceId: number): Promise<WorkspaceGoLiveSnapshot> {
    const [stabilization, leaveMigration, payrollMigration, leaveRuntimeMode] = await Promise.all([
      platformStabilizationService.workspaceSnapshot(workspaceId),
      getLeaveMigrationReport(workspaceId),
      getPayrollMigrationReport(workspaceId),
      getLeaveRuntimeMode(workspaceId),
    ]);

    const hrEnabled = await moduleGovernanceService.isModuleEnabled(workspaceId, "hr");
    const cutover = infrastructureCutoverStatus(workspaceId);

    const phases: GoLivePhase[] = [];
    const blockers: string[] = [];

    phases.push({
      key: "hcm_foundation",
      label: "HCM foundation (HR module + employee linking)",
      labelAr: "أساس HCM (موديول HR وربط الموظفين)",
      status: hrEnabled ? "complete" : "blocked",
      detail: hrEnabled ? undefined : "Enable HR module",
    });
    if (!hrEnabled) blockers.push("hr_module_disabled");

    const leaveOk =
      leaveMigration.pendingMigration === 0 &&
      (leaveRuntimeMode === "transition" || leaveRuntimeMode === "canonical");
    phases.push({
      key: "leave_cutover",
      label: "Leave migration & runtime mode",
      labelAr: "ترحيل الإجازات ووضع التشغيل",
      status: leaveOk ? "complete" : leaveMigration.pendingMigration > 0 ? "pending" : "blocked",
      detail: `${leaveMigration.pendingMigration} pending · mode ${leaveRuntimeMode}`,
    });
    if (leaveMigration.pendingMigration > 0) blockers.push("leave_migration_pending");
    if (leaveRuntimeMode === "legacy") blockers.push("leave_runtime_legacy");

    const payrollOk = payrollMigration.pendingMigration === 0;
    phases.push({
      key: "payroll_cutover",
      label: "Payroll legacy migration",
      labelAr: "ترحيل الرواتب legacy",
      status: payrollOk ? "complete" : "pending",
      detail: `${payrollMigration.pendingMigration} pending`,
    });
    if (!payrollOk) blockers.push("payroll_migration_pending");

    const dualLeave = stabilization.risks.includes("dual_leave_models");
    const dualPayroll = stabilization.risks.includes("dual_payroll_models");
    phases.push({
      key: "legacy_freeze",
      label: "Legacy write freeze (recommended)",
      labelAr: "تجميد كتابة legacy (موصى به)",
      status:
        cutover.leave.legacyFreeze && cutover.legacyPayrollFrozen
          ? "complete"
          : dualLeave || dualPayroll
            ? "pending"
            : "complete",
      detail: `leave freeze ${cutover.leave.legacyFreeze ? "on" : "off"} · payroll ${cutover.legacyPayrollFrozen ? "on" : "off"}`,
    });

    const hcmGoLiveReady = blockers.length === 0;
    const recommendations: string[] = [...stabilization.recommendations];

    if (hcmGoLiveReady) {
      recommendations.unshift(
        "HCM go-live gate OPEN — canonical HR, leave, and payroll runtimes are ready",
      );
      if (!cutover.leave.legacyFreeze || !cutover.legacyPayrollFrozen) {
        recommendations.push("Set LEGACY_LEAVE_FREEZE and LEGACY_PAYROLL_FREEZE in production");
      }
    } else {
      recommendations.unshift(`HCM go-live blocked: ${blockers.join(", ")}`);
    }

    return {
      hcmGoLiveReady,
      phases,
      blockers,
      recommendations,
      stabilization,
      leaveRuntimeMode,
      generatedAt: new Date().toISOString(),
    };
  }
}

export const workspaceGoLiveService = new WorkspaceGoLiveService();
