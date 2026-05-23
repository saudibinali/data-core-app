import { db } from "@workspace/db";
import {
  employeesTable,
  workforceLifecycleEventsTable,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { getApprovalRuntimeMode } from "../../approval/settings";
import { startApproval } from "../../approval/runtime-service";
import { validateWorkforceGovernance } from "./governance-service";
import { recordAndApplyMovement, type MovementType } from "./movement-service";
import { appendTimelineEvent } from "./timeline-service";
import { recordWorkforceAudit } from "./audit-service";

export type LifecycleEventType =
  | "onboarding"
  | "transfer"
  | "promotion"
  | "department_movement"
  | "manager_change"
  | "offboarding"
  | "termination";

const EVENT_TO_MOVEMENT: Record<LifecycleEventType, MovementType> = {
  onboarding: "onboarding",
  transfer: "transfer",
  promotion: "promotion",
  department_movement: "dept_change",
  manager_change: "manager_change",
  offboarding: "offboarding",
  termination: "termination",
};

const EVENT_TO_PROCESS: Partial<Record<LifecycleEventType, string>> = {
  onboarding: "hr.onboarding",
  transfer: "hr.transfer",
  promotion: "hr.promotion",
  offboarding: "hr.offboarding",
  termination: "hr.offboarding",
};

const EVENT_LABELS: Record<LifecycleEventType, string> = {
  onboarding: "Onboarding",
  transfer: "Transfer",
  promotion: "Promotion",
  department_movement: "Department movement",
  manager_change: "Manager change",
  offboarding: "Offboarding",
  termination: "Termination",
};

export type LifecyclePayload = {
  toOrgUnitId?: number | null;
  toManagerId?: number | null;
  toJobTitleId?: number | null;
  toStatus?: string | null;
  reason?: string | null;
  notes?: string | null;
  skipApproval?: boolean;
  applyImmediately?: boolean;
};

export type InitiateLifecycleInput = {
  workspaceId: number;
  employeeId: number;
  eventType: LifecycleEventType;
  effectiveDate?: string | null;
  payload?: LifecyclePayload;
  actorUserId?: number | null;
  requesterEmployeeId?: number | null;
};

export async function listLifecycleEvents(
  workspaceId: number,
  employeeId: number,
  limit = 50,
) {
  return db
    .select()
    .from(workforceLifecycleEventsTable)
    .where(
      and(
        eq(workforceLifecycleEventsTable.workspaceId, workspaceId),
        eq(workforceLifecycleEventsTable.employeeId, employeeId),
      ),
    )
    .orderBy(desc(workforceLifecycleEventsTable.createdAt))
    .limit(limit);
}

export async function initiateLifecycleEvent(input: InitiateLifecycleInput) {
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

  const payload = input.payload ?? {};
  const effectiveDate = input.effectiveDate ?? new Date().toISOString().slice(0, 10);

  const governance = await validateWorkforceGovernance(input.workspaceId, input.employeeId, {
    status: payload.toStatus ?? employee.status,
    orgUnitId: payload.toOrgUnitId !== undefined ? payload.toOrgUnitId : employee.orgUnitId,
    directManagerId: payload.toManagerId !== undefined ? payload.toManagerId : employee.directManagerId,
    employmentType: employee.employmentType,
    jobTitleId: payload.toJobTitleId !== undefined ? payload.toJobTitleId : employee.jobTitleId,
  });

  if (!governance.ok) {
    throw Object.assign(new Error(governance.error), {
      statusCode: governance.status,
      code: governance.code,
    });
  }

  const [event] = await db
    .insert(workforceLifecycleEventsTable)
    .values({
      workspaceId: input.workspaceId,
      employeeId: input.employeeId,
      eventType: input.eventType,
      status: "pending",
      effectiveDate,
      payload,
      createdBy: input.actorUserId ?? null,
    })
    .returning();

  let approvalInstanceId: number | null = null;
  const processCode = EVENT_TO_PROCESS[input.eventType];
  const approvalMode = await getApprovalRuntimeMode(input.workspaceId);

  if (
    processCode
    && !payload.skipApproval
    && (approvalMode === "dual" || approvalMode === "unified")
    && input.requesterEmployeeId
  ) {
    try {
      const instance = await startApproval({
        workspaceId: input.workspaceId,
        entityType: "workforce_lifecycle",
        entityId: event!.id,
        processCode,
        requesterEmployeeId: input.requesterEmployeeId,
        requesterUserId: input.actorUserId ?? null,
        context: { eventType: input.eventType, employeeId: input.employeeId, payload },
      });
      approvalInstanceId = instance.instance.id;
      await db
        .update(workforceLifecycleEventsTable)
        .set({ approvalInstanceId, status: "in_progress", updatedAt: new Date() })
        .where(eq(workforceLifecycleEventsTable.id, event!.id));
    } catch {
      // Approval optional — lifecycle event still recorded
    }
  }

  const label = EVENT_LABELS[input.eventType];
  await appendTimelineEvent({
    workspaceId: input.workspaceId,
    employeeId: input.employeeId,
    eventCategory: "lifecycle",
    eventType: input.eventType,
    title: `${label} initiated`,
    description: payload.reason ?? payload.notes ?? null,
    actorUserId: input.actorUserId,
    correlationId: `lifecycle:${event!.id}`,
    sourceTable: "workforce_lifecycle_events",
    sourceId: event!.id,
    metadata: { effectiveDate, payload, approvalInstanceId },
  });

  await recordWorkforceAudit({
    workspaceId: input.workspaceId,
    entityType: "workforce_lifecycle",
    entityId: event!.id,
    action: `lifecycle.${input.eventType}.initiated`,
    actorUserId: input.actorUserId,
    afterState: { eventType: input.eventType, payload, effectiveDate },
    correlationId: `lifecycle:${event!.id}`,
  });

  if (payload.skipApproval || !approvalInstanceId) {
    return completeLifecycleEvent(input.workspaceId, event!.id, input.actorUserId ?? null, {
      applyImmediately: payload.applyImmediately,
    });
  }

  return { event: event!, approvalInstanceId, status: approvalInstanceId ? "in_progress" : "pending" };
}

export async function completeLifecycleEvent(
  workspaceId: number,
  lifecycleEventId: number,
  actorUserId: number | null,
  opts?: { applyImmediately?: boolean },
) {
  const [event] = await db
    .select()
    .from(workforceLifecycleEventsTable)
    .where(
      and(
        eq(workforceLifecycleEventsTable.id, lifecycleEventId),
        eq(workforceLifecycleEventsTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!event) {
    throw Object.assign(new Error("Lifecycle event not found"), { statusCode: 404 });
  }

  if (event.status === "completed") {
    return { event, movement: null };
  }

  const payload = (event.payload ?? {}) as LifecyclePayload;
  const movementType = EVENT_TO_MOVEMENT[event.eventType as LifecycleEventType] ?? "other";

  const { movement } = await recordAndApplyMovement({
    workspaceId,
    employeeId: event.employeeId,
    movementType,
    effectiveDate: event.effectiveDate ?? new Date().toISOString().slice(0, 10),
    toOrgUnitId: payload.toOrgUnitId,
    toManagerId: payload.toManagerId,
    toJobTitleId: payload.toJobTitleId,
    toStatus: payload.toStatus,
    reason: payload.reason,
    notes: payload.notes,
    lifecycleEventId: event.id,
    approvalInstanceId: event.approvalInstanceId,
    applyImmediately: opts?.applyImmediately ?? payload.applyImmediately ?? true,
    actorUserId,
    correlationId: `lifecycle:${event.id}`,
  });

  const [completed] = await db
    .update(workforceLifecycleEventsTable)
    .set({
      status: "completed",
      movementId: movement.id,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(workforceLifecycleEventsTable.id, event.id))
    .returning();

  const label = EVENT_LABELS[event.eventType as LifecycleEventType] ?? event.eventType;
  await appendTimelineEvent({
    workspaceId,
    employeeId: event.employeeId,
    eventCategory: "lifecycle",
    eventType: `${event.eventType}.completed`,
    title: `${label} completed`,
    actorUserId,
    correlationId: `lifecycle:${event.id}`,
    sourceTable: "workforce_lifecycle_events",
    sourceId: event.id,
  });

  return { event: completed!, movement };
}
