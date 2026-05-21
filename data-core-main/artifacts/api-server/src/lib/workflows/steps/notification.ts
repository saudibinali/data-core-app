import { db } from "@workspace/db";
import { notificationsTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../../logger";
import type { NotificationStep, ExecutionContext, StepResult } from "../types";

// ── Governance: notification fanout cap (Phase 3 - P3-D) ─────────────────────
//
// Unbounded role-targeted notifications can produce thousands of rows per
// execution when a workspace has many members (WG-08 in architecture review).
// This cap limits recipient resolution to MAX_NOTIFICATION_RECIPIENTS_PER_STEP.
//
// If recipients are truncated, a structured warning is logged so the admin can
// review the execution detail and see the actual delivery count vs expected.
// The step does NOT fail - it delivers to the capped subset.
//
// Cap is intentionally generous (50) to handle real-world approval chains while
// preventing accidental mass-notification from poorly configured workflows.
const MAX_NOTIFICATION_RECIPIENTS_PER_STEP = 50;

export async function executeNotificationStep(
  step: NotificationStep,
  ctx: ExecutionContext,
): Promise<StepResult> {
  const { config } = step;
  const data = { ...ctx.triggerData, ...ctx.resolvedData };

  let recipientIds: number[] = [];

  if (config.recipientType === "specific" && config.recipientIds?.length) {
    recipientIds = config.recipientIds;
  } else if (config.recipientType === "creator" && ctx.triggeredBy) {
    recipientIds = [ctx.triggeredBy];
  } else if (config.recipientType === "assignee") {
    const assigneeId = data["assigneeId"] ?? data["assigneeUserId"];
    if (typeof assigneeId === "number") recipientIds = [assigneeId];
  } else if (config.recipientType === "role" && config.recipientRole) {
    const users = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.workspaceId, ctx.workspaceId),
          eq(usersTable.role, config.recipientRole),
          eq(usersTable.status, "active"),
        ),
      );
    recipientIds = users.map((u) => u.id);
  } else if (config.recipientType === "manager") {
    const triggerId = ctx.triggeredBy ?? (data["employeeId"] as number | undefined);
    if (triggerId) {
      const [user] = await db
        .select({ lineManagerId: usersTable.lineManagerId })
        .from(usersTable)
        .where(eq(usersTable.id, triggerId));
      if (user?.lineManagerId) recipientIds = [user.lineManagerId];
    }
  }

  if (recipientIds.length === 0) {
    return { success: true, output: { skipped: true, reason: "no_recipients" } };
  }

  // ── P3-D: Apply notification fanout cap ───────────────────────────────────
  //
  // If the resolved recipient list exceeds MAX_NOTIFICATION_RECIPIENTS_PER_STEP,
  // truncate it and emit a structured warning.  The step does NOT fail - it
  // delivers to the capped subset so subsequent steps can still execute.
  //
  // Admins can inspect the truncated count in the execution step output.
  // The warning log includes the full recipient count before truncation for
  // post-incident analysis without requiring a DB query.
  let truncated = false;
  if (recipientIds.length > MAX_NOTIFICATION_RECIPIENTS_PER_STEP) {
    logger.warn(
      {
        stepName:          step.name,
        recipientType:     config.recipientType,
        resolvedCount:     recipientIds.length,
        cappedTo:          MAX_NOTIFICATION_RECIPIENTS_PER_STEP,
        workspaceId:       ctx.workspaceId,
      },
      "[governance] Notification step recipient list truncated to cap (P3-D)",
    );
    recipientIds = recipientIds.slice(0, MAX_NOTIFICATION_RECIPIENTS_PER_STEP);
    truncated = true;
  }

  await db.insert(notificationsTable).values(
    recipientIds.map((userId) => ({
      userId,
      type: "workflow",
      title: config.title,
      message: config.message,
      link: config.link ?? null,
    })),
  );

  return {
    success: true,
    output: {
      notified: recipientIds.length,
      recipientIds,
      ...(truncated && { truncated: true, cappedTo: MAX_NOTIFICATION_RECIPIENTS_PER_STEP }),
    },
  };
}
