import { db } from "@workspace/db";
import { notificationsTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../../logger";
import type { ApprovalStep, ExecutionContext, StepResult } from "../types";
import { resolveManagerUserIdForTrigger, resolveEmployeeByUserId } from "../../workforce/manager-resolver";
import { resolveManagerUserIdForEmployee } from "../../workforce/org/reporting-hierarchy-service";
import { getOrgRuntimeMode } from "../../workforce/org/org-runtime-settings";

// ── Governance: approver notification cap (Phase 3 - P3-D) ───────────────────
//
// The same fanout risk applies to approval notifications (WG-08).
// An approval step targeting all "admin" users sends one notification per admin.
// Capped at MAX_APPROVER_NOTIFICATIONS to match the notification step limit.
const MAX_APPROVER_NOTIFICATIONS = 50;

/**
 * P5-F: executeApprovalStep
 *
 * Extended to accept executionId and workflowVersion for structured audit
 * logging.  These are read-only identifiers - the handler does not write
 * approval records (those are written by resumeExecution/rejectExecution
 * after the guarded transition succeeds).
 *
 * Emits:  approval_requested  - structured event with full traceability fields.
 */
export async function executeApprovalStep(
  step:            ApprovalStep,
  ctx:             ExecutionContext,
  executionId?:    number,
  workflowVersion?: number | null,
): Promise<StepResult> {
  const { config } = step;
  const data = { ...ctx.triggerData, ...ctx.resolvedData };

  let approverIds: number[] = [];

  if (config.approverType === "specific" && config.approverIds?.length) {
    approverIds = config.approverIds;
  } else if (config.approverType === "role" && config.approverRole) {
    const users = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.workspaceId, ctx.workspaceId),
          eq(usersTable.role, config.approverRole),
          eq(usersTable.status, "active"),
        ),
      );
    approverIds = users.map((u) => u.id);
  } else if (config.approverType === "manager") {
    const triggerId = ctx.triggeredBy ?? (data["employeeId"] as number | undefined);
    if (triggerId) {
      const employee = await resolveEmployeeByUserId(ctx.workspaceId, triggerId);
      const orgMode = await getOrgRuntimeMode(ctx.workspaceId);

      if (employee && (orgMode === "active" || orgMode === "shadow")) {
        const resolved = await resolveManagerUserIdForEmployee(ctx.workspaceId, employee.id);
        if (resolved) {
          if (orgMode === "shadow") {
            const [legacyUser] = await db
              .select({ lineManagerId: usersTable.lineManagerId })
              .from(usersTable)
              .where(eq(usersTable.id, triggerId));
            if (legacyUser?.lineManagerId !== resolved.userId) {
              logger.info(
                {
                  workspaceId: ctx.workspaceId,
                  triggerUserId: triggerId,
                  resolved,
                  legacy: legacyUser?.lineManagerId,
                },
                "Org runtime shadow: workflow manager mismatch",
              );
            }
          }
          if (orgMode === "active") {
            approverIds = [resolved.userId];
          }
        }
      }

      if (!approverIds.length) {
        const mgrUserId = await resolveManagerUserIdForTrigger(ctx.workspaceId, triggerId);
        if (mgrUserId) approverIds = [mgrUserId];
      }
    }
  }

  if (approverIds.length === 0) {
    logger.warn(
      {
        executionId,
        workflowVersion: workflowVersion ?? null,
        stepIndex:   step.index,
        stepName:    step.name,
        approverType: config.approverType,
        workspaceId:  ctx.workspaceId,
        action:       "approval_requested_no_approvers",
      },
      "[governance] P5-F: Approval step fired but no approvers resolved - step will skip",
    );
    return { success: true, output: { skipped: true, reason: "no_approvers" } };
  }

  // ── P3-D: Apply approver notification cap ─────────────────────────────────
  //
  // Same fanout risk as notification steps - role-based approver resolution
  // can return all active users with a given role.  Cap to prevent DB floods.
  let truncated = false;
  if (approverIds.length > MAX_APPROVER_NOTIFICATIONS) {
    logger.warn(
      {
        stepName:      step.name,
        approverType:  config.approverType,
        resolvedCount: approverIds.length,
        cappedTo:      MAX_APPROVER_NOTIFICATIONS,
        workspaceId:   ctx.workspaceId,
      },
      "[governance] Approval step approver list truncated to cap (P3-D)",
    );
    approverIds = approverIds.slice(0, MAX_APPROVER_NOTIFICATIONS);
    truncated = true;
  }

  const entityTitle = (data["title"] as string | undefined) ?? "Item";

  await db.insert(notificationsTable).values(
    approverIds.map((userId) => ({
      userId,
      type: "approval_request",
      title: `Approval Required: ${config.title}`,
      message: `Your approval is required for: ${entityTitle}`,
      link: `/self-service/approvals`,
    })),
  );

  // ── P5-F: Structured audit event - approval_requested ─────────────────────
  //
  // Emitted when the approval step fires: notifications sent, execution is
  // about to pause.  This is the start of the approval lifecycle record.
  // The decision event (approval_decision_recorded / approval_decision_rejected)
  // is emitted by resumeExecution / rejectExecution after the guarded UPDATE.
  logger.info(
    {
      executionId:     executionId ?? null,
      workflowVersion: workflowVersion ?? null,
      stepIndex:       step.index,
      stepName:        step.name,
      approverType:    config.approverType,
      approverCount:   approverIds.length,
      approverIds,
      workspaceId:     ctx.workspaceId,
      action:          "approval_requested",
      ...(truncated && { truncated: true, cappedTo: MAX_APPROVER_NOTIFICATIONS }),
    },
    "[governance] P5-F: Approval step fired - execution will pause at waiting_approval",
  );

  return {
    success: true,
    waitForApproval: config.approvalType !== "conditional",
    output: {
      approvalType: config.approvalType,
      approverIds,
      status: "pending_approval",
      ...(truncated && { truncated: true, cappedTo: MAX_APPROVER_NOTIFICATIONS }),
    },
  };
}
