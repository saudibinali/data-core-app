import { db } from "@workspace/db";
import { workflowTasksTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import type { TaskStep, ExecutionContext, StepResult } from "../types";

export async function executeTaskStep(
  step: TaskStep,
  ctx: ExecutionContext,
  executionId: number,
): Promise<StepResult> {
  const { config } = step;
  const data = { ...ctx.triggerData, ...ctx.resolvedData };

  let assigneeId: number | null = null;

  if (config.assigneeType === "specific" && config.assigneeId) {
    assigneeId = config.assigneeId;
  } else if (config.assigneeType === "creator" && ctx.triggeredBy) {
    assigneeId = ctx.triggeredBy;
  } else if (config.assigneeType === "manager") {
    const triggerId = ctx.triggeredBy ?? (data["employeeId"] as number | undefined);
    if (triggerId) {
      const [user] = await db
        .select({ lineManagerId: usersTable.lineManagerId })
        .from(usersTable)
        .where(eq(usersTable.id, triggerId));
      assigneeId = user?.lineManagerId ?? null;
    }
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

  const dueDate = config.dueDays
    ? new Date(Date.now() + config.dueDays * 86_400_000)
    : null;

  const [task] = await db
    .insert(workflowTasksTable)
    .values({
      workspaceId: ctx.workspaceId,
      executionId,
      stepIndex: step.index,
      title: config.title,
      description: config.description ?? null,
      assigneeId,
      dueDate,
      priority: config.priority,
      status: "pending",
    })
    .returning({ id: workflowTasksTable.id });

  return { success: true, output: { taskId: task?.id, assigneeId } };
}
