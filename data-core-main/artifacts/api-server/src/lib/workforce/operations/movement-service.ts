import { db } from "@workspace/db";
import {
  employeeMovementsTable,
  employeesTable,
  hrEmployeePositionHistoryTable,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { syncLegacyUserFieldsFromEmployee } from "../manager-resolver";
import { shouldRunLegacyAdapter } from "../stabilization/cleanup-staging";
import { recordLegacyUsage } from "../stabilization/usage-telemetry";
import { validateEmployeeOrgLinking } from "../org/employee-org-validation";
import { appendTimelineEvent } from "./timeline-service";
import { recordWorkforceAudit } from "./audit-service";

export type MovementType =
  | "transfer"
  | "promotion"
  | "demotion"
  | "lateral"
  | "dept_change"
  | "manager_change"
  | "title_change"
  | "onboarding"
  | "offboarding"
  | "termination"
  | "other";

export type RecordMovementInput = {
  workspaceId: number;
  employeeId: number;
  movementType: MovementType;
  effectiveDate: string;
  toOrgUnitId?: number | null;
  toManagerId?: number | null;
  toJobTitleId?: number | null;
  toStatus?: string | null;
  reason?: string | null;
  notes?: string | null;
  lifecycleEventId?: number | null;
  approvalInstanceId?: number | null;
  applyImmediately?: boolean;
  actorUserId?: number | null;
  correlationId?: string | null;
};

const MOVEMENT_LABELS: Record<string, string> = {
  transfer: "Transfer",
  promotion: "Promotion",
  demotion: "Demotion",
  lateral: "Lateral move",
  dept_change: "Department change",
  manager_change: "Manager change",
  title_change: "Title change",
  onboarding: "Onboarding",
  offboarding: "Offboarding",
  termination: "Termination",
  other: "Movement",
};

export async function listEmployeeMovements(
  workspaceId: number,
  employeeId: number,
  limit = 50,
) {
  return db
    .select()
    .from(employeeMovementsTable)
    .where(
      and(
        eq(employeeMovementsTable.workspaceId, workspaceId),
        eq(employeeMovementsTable.employeeId, employeeId),
      ),
    )
    .orderBy(desc(employeeMovementsTable.effectiveDate), desc(employeeMovementsTable.id))
    .limit(limit);
}

export async function recordAndApplyMovement(input: RecordMovementInput) {
  const [employee] = await db
    .select()
    .from(employeesTable)
    .where(
      and(
        eq(employeesTable.id, input.employeeId),
        eq(employeesTable.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);

  if (!employee) {
    throw Object.assign(new Error("Employee not found"), { statusCode: 404 });
  }

  const nextOrg = input.toOrgUnitId !== undefined ? input.toOrgUnitId : employee.orgUnitId;
  const nextManager = input.toManagerId !== undefined ? input.toManagerId : employee.directManagerId;
  const nextStatus = input.toStatus !== undefined && input.toStatus !== null
    ? input.toStatus
    : employee.status;

  const orgValidation = await validateEmployeeOrgLinking(
    input.workspaceId,
    input.employeeId,
    {
      status: nextStatus,
      orgUnitId: nextOrg,
      directManagerId: nextManager,
    },
  );
  if (!orgValidation.ok) {
    throw Object.assign(new Error(orgValidation.error), {
      statusCode: orgValidation.status,
      code: orgValidation.code,
    });
  }

  const [movement] = await db
    .insert(employeeMovementsTable)
    .values({
      workspaceId: input.workspaceId,
      employeeId: input.employeeId,
      movementType: input.movementType,
      effectiveDate: input.effectiveDate,
      fromOrgUnitId: employee.orgUnitId,
      toOrgUnitId: input.toOrgUnitId ?? null,
      fromManagerId: employee.directManagerId,
      toManagerId: input.toManagerId ?? null,
      fromJobTitleId: employee.jobTitleId,
      toJobTitleId: input.toJobTitleId ?? null,
      fromStatus: employee.status,
      toStatus: input.toStatus ?? null,
      reason: input.reason ?? null,
      notes: input.notes ?? null,
      lifecycleEventId: input.lifecycleEventId ?? null,
      approvalInstanceId: input.approvalInstanceId ?? null,
      createdBy: input.actorUserId ?? null,
    })
    .returning();

  // Legacy position history mirror (non-breaking compat; skipped at cleanup stage3+)
  if (await shouldRunLegacyAdapter(input.workspaceId, "position_history_mirror")) {
    await db.insert(hrEmployeePositionHistoryTable).values({
      workspaceId: input.workspaceId,
      employeeId: input.employeeId,
      changeType: input.movementType,
      effectiveDate: input.effectiveDate,
      fromOrgUnitId: employee.orgUnitId,
      toOrgUnitId: input.toOrgUnitId ?? null,
      fromManagerId: employee.directManagerId,
      toManagerId: input.toManagerId ?? null,
      notes: input.notes ?? null,
      createdBy: input.actorUserId ?? null,
    }).catch(() => undefined);
  } else {
    void recordLegacyUsage({
      workspaceId: input.workspaceId,
      eventType: "adapter_skipped",
      legacySurface: "hr_employee_position_history",
      sourcePath: "movement-service:recordAndApplyMovement",
      entityType: "employee",
      entityId: input.employeeId,
    }).catch(() => undefined);
  }

  const shouldApply = input.applyImmediately !== false;
  let appliedEmployee = employee;

  if (shouldApply) {
    const updates: Record<string, unknown> = {};
    if (input.toOrgUnitId !== undefined) updates.orgUnitId = input.toOrgUnitId;
    if (input.toManagerId !== undefined) updates.directManagerId = input.toManagerId;
    if (input.toJobTitleId !== undefined) updates.jobTitleId = input.toJobTitleId;
    if (input.toStatus !== undefined && input.toStatus !== null) updates.status = input.toStatus;

    if (Object.keys(updates).length) {
      const [updated] = await db
        .update(employeesTable)
        .set(updates)
        .where(
          and(
            eq(employeesTable.id, input.employeeId),
            eq(employeesTable.workspaceId, input.workspaceId),
          ),
        )
        .returning();
      appliedEmployee = updated ?? employee;

      await db
        .update(employeeMovementsTable)
        .set({ appliedAt: new Date() })
        .where(eq(employeeMovementsTable.id, movement!.id));

      if ("directManagerId" in updates || "orgUnitId" in updates) {
        void syncLegacyUserFieldsFromEmployee(input.workspaceId, input.employeeId).catch(() => undefined);
      }
    }
  }

  const label = MOVEMENT_LABELS[input.movementType] ?? input.movementType;
  await appendTimelineEvent({
    workspaceId: input.workspaceId,
    employeeId: input.employeeId,
    eventCategory: "movement",
    eventType: input.movementType,
    title: `${label} recorded`,
    description: input.reason ?? input.notes ?? null,
    actorUserId: input.actorUserId,
    correlationId: input.correlationId ?? (input.lifecycleEventId ? `lifecycle:${input.lifecycleEventId}` : null),
    sourceTable: "employee_movements",
    sourceId: movement!.id,
    metadata: {
      effectiveDate: input.effectiveDate,
      fromOrgUnitId: employee.orgUnitId,
      toOrgUnitId: input.toOrgUnitId ?? null,
      fromManagerId: employee.directManagerId,
      toManagerId: input.toManagerId ?? null,
    },
  });

  await recordWorkforceAudit({
    workspaceId: input.workspaceId,
    entityType: "employee",
    entityId: input.employeeId,
    action: `movement.${input.movementType}`,
    actorUserId: input.actorUserId,
    beforeState: {
      orgUnitId: employee.orgUnitId,
      directManagerId: employee.directManagerId,
      jobTitleId: employee.jobTitleId,
      status: employee.status,
    },
    afterState: {
      orgUnitId: appliedEmployee.orgUnitId,
      directManagerId: appliedEmployee.directManagerId,
      jobTitleId: appliedEmployee.jobTitleId,
      status: appliedEmployee.status,
    },
    correlationId: input.correlationId ?? null,
  });

  return { movement: movement!, employee: appliedEmployee };
}
