import { db } from "@workspace/db";
import { ticketsTable, workflowTasksTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { StatusUpdateStep, ExecutionContext, StepResult } from "../types";

export async function executeStatusUpdateStep(
  step: StatusUpdateStep,
  ctx: ExecutionContext,
): Promise<StepResult> {
  const { config } = step;
  const data = { ...ctx.triggerData, ...ctx.resolvedData };
  const entityId = data[config.entityIdField];

  if (typeof entityId !== "number") {
    return { success: false, error: `No entity ID found at field "${config.entityIdField}"` };
  }

  if (config.entity === "ticket") {
    await db
      .update(ticketsTable)
      .set({ status: config.newStatus })
      .where(eq(ticketsTable.id, entityId));
  } else if (config.entity === "workflow_task") {
    await db
      .update(workflowTasksTable)
      .set({ status: config.newStatus })
      .where(eq(workflowTasksTable.id, entityId));
  }

  return { success: true, output: { entity: config.entity, entityId, newStatus: config.newStatus } };
}
