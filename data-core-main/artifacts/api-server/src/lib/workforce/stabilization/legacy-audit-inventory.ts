/** Static legacy dependency inventory — audit baseline (Phase 5). No runtime deletion. */

export type LegacyDependencyEntry = {
  surface: string;
  kind: "table" | "column" | "route" | "adapter";
  replacement: string;
  removalPhase: string;
  activeWriters: string[];
  activeReaders: string[];
};

export const LEGACY_DEPENDENCY_INVENTORY: LegacyDependencyEntry[] = [
  {
    surface: "departments",
    kind: "table",
    replacement: "hr_org_units + legacy_department_org_map",
    removalPhase: "5.2",
    activeWriters: ["routes/departments.ts"],
    activeReaders: ["routes/auth.ts", "routes/tickets.ts", "routes/admin.ts"],
  },
  {
    surface: "users.departmentId",
    kind: "column",
    replacement: "employees.orgUnitId",
    removalPhase: "5.3",
    activeWriters: ["lib/workforce/manager-resolver.ts:syncLegacyUserFieldsFromEmployee"],
    activeReaders: ["routes/auth.ts", "routes/tickets.ts"],
  },
  {
    surface: "users.lineManagerId",
    kind: "column",
    replacement: "employees.directManagerId + reporting chain",
    removalPhase: "5.3",
    activeWriters: ["lib/workforce/manager-resolver.ts:syncLegacyUserFieldsFromEmployee"],
    activeReaders: ["lib/workforce/manager-resolver.ts", "lib/workflows/steps/approval.ts"],
  },
  {
    surface: "hr_employee_activity",
    kind: "table",
    replacement: "workforce_timeline_events + workforce_audit_log",
    removalPhase: "5.6",
    activeWriters: ["routes/hr.ts:logActivity"],
    activeReaders: ["routes/hr.ts GET /activity", "employee-file-service.ts"],
  },
  {
    surface: "hr_employee_position_history",
    kind: "table",
    replacement: "employee_movements",
    removalPhase: "5.6",
    activeWriters: ["routes/hr.ts POST /position-history", "movement-service.ts mirror"],
    activeReaders: ["routes/hr.ts GET /position-history"],
  },
  {
    surface: "approvals",
    kind: "table",
    replacement: "approval_instances + approval_steps",
    removalPhase: "5.4",
    activeWriters: ["routes/approvals.ts"],
    activeReaders: ["routes/approvals.ts"],
  },
  {
    surface: "workflow_approvals",
    kind: "table",
    replacement: "approval_steps",
    removalPhase: "5.4",
    activeWriters: ["lib/workflows/steps/approval.ts"],
    activeReaders: ["lib/workflows"],
  },
  {
    surface: "leave_approval_steps",
    kind: "table",
    replacement: "approval_steps (dual/unified mode)",
    removalPhase: "5.4",
    activeWriters: ["routes/leave.ts"],
    activeReaders: ["routes/leave.ts", "lib/approval/runtime-service.ts"],
  },
  {
    surface: "legacy_department_org_map",
    kind: "table",
    replacement: "native hr_org_units",
    removalPhase: "5.7",
    activeWriters: ["lib/workforce/org/org-runtime-startup.ts backfill"],
    activeReaders: ["lib/workforce/manager-resolver.ts"],
  },
];

export function getLegacyAuditReport() {
  return {
    generatedAt: new Date().toISOString(),
    totalSurfaces: LEGACY_DEPENDENCY_INVENTORY.length,
    inventory: LEGACY_DEPENDENCY_INVENTORY,
    rules: [
      "No deletion before full audit + telemetry + shadow validation",
      "Cleanup is staged: stage1 read-only → stage2 monitor → stage3 disable adapters → stage4 archival plan only",
      "Default workforce_cleanup_stage = none (production unchanged)",
    ],
  };
}
