import { db } from "@workspace/db";
import {
  approvalInstancesTable,
  approvalStepsTable,
  approvalProcessPoliciesTable,
  notificationsTable,
} from "@workspace/db";
import { and, eq, asc, desc, sql, inArray } from "drizzle-orm";
import { logger } from "../logger";
import { getApprovalRuntimeMode } from "./settings";
import { getProcessPolicy, resolveApproversForPolicy } from "./routing-resolver";
import type { StartApprovalInput, InboxItem } from "./types";
import { incrementRuntimeMetric } from "../workforce/stabilization/observability-metrics";

function dueAtFromHours(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

export async function findInstanceByEntity(
  workspaceId: number,
  entityType: string,
  entityId: number,
) {
  const [row] = await db
    .select()
    .from(approvalInstancesTable)
    .where(
      and(
        eq(approvalInstancesTable.workspaceId, workspaceId),
        eq(approvalInstancesTable.entityType, entityType),
        eq(approvalInstancesTable.entityId, entityId),
      ),
    )
    .orderBy(desc(approvalInstancesTable.id))
    .limit(1);
  return row ?? null;
}

export async function startApproval(input: StartApprovalInput) {
  const policy = await getProcessPolicy(input.workspaceId, input.processCode);
  if (!policy) {
    throw Object.assign(new Error(`Unknown approval process: ${input.processCode}`), { statusCode: 400 });
  }

  if (!input.requesterEmployeeId) {
    throw Object.assign(new Error("requesterEmployeeId is required for org-aware routing"), { statusCode: 400 });
  }

  const approvers = await resolveApproversForPolicy(
    input.workspaceId,
    policy,
    input.requesterEmployeeId,
  );

  if (!approvers.length) {
    throw Object.assign(new Error("No approvers could be resolved for this request"), { statusCode: 422 });
  }

  const [instance] = await db
    .insert(approvalInstancesTable)
    .values({
      workspaceId: input.workspaceId,
      entityType: input.entityType,
      entityId: input.entityId,
      processCode: input.processCode,
      requesterEmployeeId: input.requesterEmployeeId,
      requesterUserId: input.requesterUserId,
      status: "pending",
      currentStepOrder: 1,
      context: input.context ?? null,
    })
    .returning();

  const steps = [];
  for (const approver of approvers) {
    const [step] = await db
      .insert(approvalStepsTable)
      .values({
        instanceId: instance!.id,
        stepOrder: approver.stepOrder,
        routingSource: approver.routingSource,
        approverEmployeeId: approver.employeeId,
        approverUserId: approver.userId,
        status: approver.stepOrder === 1 ? "pending" : "skipped",
        dueAt: dueAtFromHours(policy.timeoutHours),
        notifiedAt: approver.stepOrder === 1 ? new Date() : null,
      })
      .returning();
    if (step) steps.push(step);

    if (approver.stepOrder === 1) {
      await db.insert(notificationsTable).values({
        userId: approver.userId,
        type: "approval_request",
        title: "Approval required",
        message: `You have a pending approval (${input.processCode})`,
        link: `/self-service/approvals/${instance!.id}`,
      });
    }
  }

  return { instance: instance!, steps };
}

/** Dual-write hook from leave domain. */
export async function startLeaveApproval(
  workspaceId: number,
  leaveRequestId: number,
  requesterEmployeeId: number,
  requesterUserId: number,
  context?: Record<string, unknown>,
  legacyLeaveStepId?: number,
) {
  const mode = await getApprovalRuntimeMode(workspaceId);
  if (mode === "legacy") return null;

  const existing = await findInstanceByEntity(workspaceId, "leave_request", leaveRequestId);
  if (existing) return existing;

  const policy = await getProcessPolicy(workspaceId, "leave.standard");
  if (!policy) return null;

  const approvers = await resolveApproversForPolicy(workspaceId, policy, requesterEmployeeId);
  if (!approvers.length) return null;

  const [instance] = await db
    .insert(approvalInstancesTable)
    .values({
      workspaceId,
      entityType: "leave_request",
      entityId: leaveRequestId,
      processCode: "leave.standard",
      requesterEmployeeId,
      requesterUserId,
      status: "pending",
      currentStepOrder: 1,
      context: context ?? null,
    })
    .returning();

  for (const approver of approvers) {
    await db.insert(approvalStepsTable).values({
      instanceId: instance!.id,
      stepOrder: approver.stepOrder,
      routingSource: approver.routingSource,
      approverEmployeeId: approver.employeeId,
      approverUserId: approver.userId,
      status: approver.stepOrder === 1 ? "pending" : "skipped",
      dueAt: dueAtFromHours(policy.timeoutHours),
      legacyLeaveStepId: legacyLeaveStepId ?? null,
      notifiedAt: approver.stepOrder === 1 ? new Date() : null,
    });

    if (approver.stepOrder === 1) {
      await db.insert(notificationsTable).values({
        userId: approver.userId,
        type: "approval_request",
        title: "Leave approval required",
        message: "A leave request requires your approval",
        link: `/self-service/approvals/${instance!.id}`,
      });
    }
  }

  return instance;
}

export async function syncLeaveStepDecision(
  workspaceId: number,
  leaveRequestId: number,
  decision: "approved" | "rejected",
  actorUserId: number,
  notes?: string | null,
) {
  const mode = await getApprovalRuntimeMode(workspaceId);
  if (mode === "legacy") return;

  const instance = await findInstanceByEntity(workspaceId, "leave_request", leaveRequestId);
  if (!instance) return;

  const [pendingStep] = await db
    .select()
    .from(approvalStepsTable)
    .where(
      and(
        eq(approvalStepsTable.instanceId, instance.id),
        eq(approvalStepsTable.status, "pending"),
      ),
    )
    .orderBy(asc(approvalStepsTable.stepOrder))
    .limit(1);

  if (!pendingStep) return;

  await db
    .update(approvalStepsTable)
    .set({
      status: decision,
      decidedAt: new Date(),
      decidedByUserId: actorUserId,
      notes: notes ?? null,
    })
    .where(eq(approvalStepsTable.id, pendingStep.id));

  if (decision === "approved") {
    const [nextStep] = await db
      .select()
      .from(approvalStepsTable)
      .where(
        and(
          eq(approvalStepsTable.instanceId, instance.id),
          eq(approvalStepsTable.status, "skipped"),
        ),
      )
      .orderBy(asc(approvalStepsTable.stepOrder))
      .limit(1);

    if (nextStep) {
      await db.update(approvalStepsTable)
        .set({ status: "pending", notifiedAt: new Date() })
        .where(eq(approvalStepsTable.id, nextStep.id));
      await db.update(approvalInstancesTable)
        .set({ currentStepOrder: nextStep.stepOrder, updatedAt: new Date() })
        .where(eq(approvalInstancesTable.id, instance.id));
      if (nextStep.approverUserId) {
        await db.insert(notificationsTable).values({
          userId: nextStep.approverUserId,
          type: "approval_request",
          title: "Approval required",
          message: "A request advanced to your approval step",
          link: `/self-service/approvals/${instance.id}`,
        });
      }
      return;
    }
  }

  await db
    .update(approvalInstancesTable)
    .set({ status: decision, updatedAt: new Date() })
    .where(eq(approvalInstancesTable.id, instance.id));
}

export async function decideApprovalStep(
  workspaceId: number,
  stepId: number,
  actorUserId: number,
  decision: "approved" | "rejected",
  notes?: string | null,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const [row] = await db
    .select({
      step: approvalStepsTable,
      instance: approvalInstancesTable,
    })
    .from(approvalStepsTable)
    .innerJoin(approvalInstancesTable, eq(approvalStepsTable.instanceId, approvalInstancesTable.id))
    .where(
      and(
        eq(approvalStepsTable.id, stepId),
        eq(approvalInstancesTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!row) return { ok: false, status: 404, error: "Approval step not found" };
  if (row.step.status !== "pending") {
    return { ok: false, status: 409, error: "Step is not pending" };
  }

  if (row.step.approverUserId !== actorUserId) {
    return { ok: false, status: 403, error: "Not authorized to decide this approval step" };
  }

  if (decision === "rejected" && !notes?.trim()) {
    return { ok: false, status: 400, error: "Rejection reason is required" };
  }

  if (row.instance.entityType === "leave_request") {
    await syncLeaveStepDecision(workspaceId, row.instance.entityId, decision, actorUserId, notes);
    return { ok: true };
  }

  await db.update(approvalStepsTable)
    .set({
      status: decision,
      decidedAt: new Date(),
      decidedByUserId: actorUserId,
      notes: notes ?? null,
    })
    .where(eq(approvalStepsTable.id, stepId));

  await db.update(approvalInstancesTable)
    .set({ status: decision, updatedAt: new Date() })
    .where(eq(approvalInstancesTable.id, row.instance.id));

  return { ok: true };
}

export async function getApprovalInbox(
  workspaceId: number,
  userId: number,
  opts?: { includeEscalated?: boolean; limit?: number },
): Promise<InboxItem[]> {
  const now = Date.now();
  const limit = Math.min(opts?.limit ?? 100, 500);
  incrementRuntimeMetric("approval.inbox_query");
  const rows = await db
    .select({
      instanceId: approvalInstancesTable.id,
      stepId: approvalStepsTable.id,
      stepOrder: approvalStepsTable.stepOrder,
      entityType: approvalInstancesTable.entityType,
      entityId: approvalInstancesTable.entityId,
      processCode: approvalInstancesTable.processCode,
      instanceStatus: approvalInstancesTable.status,
      stepStatus: approvalStepsTable.status,
      dueAt: approvalStepsTable.dueAt,
      routingSource: approvalStepsTable.routingSource,
      context: approvalInstancesTable.context,
      requesterUserId: approvalInstancesTable.requesterUserId,
      createdAt: approvalInstancesTable.createdAt,
      delegatedFrom: approvalStepsTable.delegatedFromEmployeeId,
    })
    .from(approvalStepsTable)
    .innerJoin(approvalInstancesTable, eq(approvalStepsTable.instanceId, approvalInstancesTable.id))
    .where(
      and(
        eq(approvalInstancesTable.workspaceId, workspaceId),
        eq(approvalStepsTable.approverUserId, userId),
        eq(approvalStepsTable.status, "pending"),
        eq(approvalInstancesTable.status, "pending"),
      ),
    )
    .orderBy(asc(approvalStepsTable.dueAt))
    .limit(limit);

  const policyNames = new Map<string, string>();
  const codes = [...new Set(rows.map((r) => r.processCode))];
  if (codes.length > 0) {
    const policies = await db
      .select({
        code: approvalProcessPoliciesTable.code,
        name: approvalProcessPoliciesTable.name,
        nameAr: approvalProcessPoliciesTable.nameAr,
      })
      .from(approvalProcessPoliciesTable)
      .where(
        and(
          eq(approvalProcessPoliciesTable.workspaceId, workspaceId),
        ),
      );
    for (const p of policies) {
      policyNames.set(p.code, p.name);
    }
  }

  return rows.map((r) => {
    const dueMs = r.dueAt ? new Date(r.dueAt).getTime() : null;
    const slaWarning = dueMs != null && dueMs - now < 6 * 60 * 60 * 1000;
    const displayName = policyNames.get(r.processCode) ?? r.processCode.replace(/\./g, " / ");
    return {
      instanceId: r.instanceId,
      stepId: r.stepId,
      stepOrder: r.stepOrder,
      entityType: r.entityType,
      entityId: r.entityId,
      processCode: r.processCode,
      processName: displayName,
      status: r.instanceStatus,
      stepStatus: r.stepStatus,
      dueAt: r.dueAt?.toISOString() ?? null,
      slaWarning,
      isDelegated: r.delegatedFrom != null,
      routingSource: r.routingSource,
      context: (r.context as Record<string, unknown> | null) ?? null,
      requesterUserId: r.requesterUserId,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

export async function escalateOverdueSteps(workspaceId?: number): Promise<number> {
  let escalated = 0;
  try {
    const overdue = await db
      .select({
        step: approvalStepsTable,
        instance: approvalInstancesTable,
      })
      .from(approvalStepsTable)
      .innerJoin(approvalInstancesTable, eq(approvalStepsTable.instanceId, approvalInstancesTable.id))
      .where(
        and(
          eq(approvalStepsTable.status, "pending"),
          eq(approvalInstancesTable.status, "pending"),
          sql`${approvalStepsTable.dueAt} < now()`,
          workspaceId ? eq(approvalInstancesTable.workspaceId, workspaceId) : sql`true`,
        ),
      )
      .limit(50);

    for (const row of overdue) {
      await db.update(approvalStepsTable)
        .set({ status: "escalated", decidedAt: new Date() })
        .where(eq(approvalStepsTable.id, row.step.id));

      await db.update(approvalInstancesTable)
        .set({ status: "escalated", updatedAt: new Date() })
        .where(eq(approvalInstancesTable.id, row.instance.id));

      logger.info(
        { instanceId: row.instance.id, stepId: row.step.id },
        "Approval step escalated (SLA exceeded)",
      );
      escalated++;
    }
  } catch (err) {
    logger.warn({ err }, "Approval escalation worker skipped");
  }
  return escalated;
}
