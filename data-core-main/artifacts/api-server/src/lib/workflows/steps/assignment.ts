import { db } from "@workspace/db";
import { ticketsTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import type { AssignmentStep, ExecutionContext, StepResult } from "../types";

export async function executeAssignmentStep(
  step: AssignmentStep,
  ctx: ExecutionContext,
): Promise<StepResult> {
  const { config } = step;
  const data = { ...ctx.triggerData, ...ctx.resolvedData };
  const entityId = data[config.entityIdField];

  if (typeof entityId !== "number") {
    return { success: false, error: `No entity ID found at field "${config.entityIdField}"` };
  }

  let assigneeId: number | null = null;

  if (config.assigneeType === "specific" && config.assigneeId) {
    assigneeId = config.assigneeId;
  } else if (config.assigneeType === "role" && config.assigneeRole) {
    const [user] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.workspaceId, ctx.workspaceId),
          eq(usersTable.role, config.assigneeRole),
          eq(usersTable.status, "active"),
        ),
      )
      .limit(1);
    assigneeId = user?.id ?? null;
  }

  if (assigneeId === null) {
    return { success: true, output: { skipped: true, reason: "no_assignee_resolved" } };
  }

  if (config.entity === "ticket") {
    await db
      .update(ticketsTable)
      .set({ assigneeUserId: assigneeId })
      .where(eq(ticketsTable.id, entityId));
  }

  return { success: true, output: { entity: config.entity, entityId, assigneeId } };
}
