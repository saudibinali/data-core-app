import { db } from "@workspace/db";
import { employeesTable, workforceDelegationsTable } from "@workspace/db";
import { and, eq, gte, lte, or, isNull } from "drizzle-orm";

/** Foundation: resolve active delegate userId for an approver employee. */
export async function resolveDelegateUserId(
  workspaceId: number,
  approverEmployeeId: number,
  asOf: Date = new Date(),
): Promise<{ delegateEmployeeId: number; delegateUserId: number } | null> {
  try {
    const today = asOf.toISOString().slice(0, 10);
    const [delegation] = await db
      .select({
        delegateEmployeeId: workforceDelegationsTable.delegateEmployeeId,
      })
      .from(workforceDelegationsTable)
      .where(
        and(
          eq(workforceDelegationsTable.workspaceId, workspaceId),
          eq(workforceDelegationsTable.delegatorEmployeeId, approverEmployeeId),
          eq(workforceDelegationsTable.isActive, true),
          lte(workforceDelegationsTable.startDate, today),
          or(
            isNull(workforceDelegationsTable.endDate),
            gte(workforceDelegationsTable.endDate, today),
          ),
        ),
      )
      .limit(1);

    if (!delegation) return null;

    const [delegate] = await db
      .select({ id: employeesTable.id, userId: employeesTable.userId, status: employeesTable.status })
      .from(employeesTable)
      .where(
        and(
          eq(employeesTable.id, delegation.delegateEmployeeId),
          eq(employeesTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);

    if (!delegate?.userId || delegate.status !== "active") return null;

    return { delegateEmployeeId: delegate.id, delegateUserId: delegate.userId };
  } catch {
    return null;
  }
}

export async function resolveEffectiveApproverUserId(
  workspaceId: number,
  approverEmployeeId: number,
  approverUserId: number,
): Promise<{ userId: number; delegated: boolean; delegatedFromEmployeeId?: number }> {
  const delegate = await resolveDelegateUserId(workspaceId, approverEmployeeId);
  if (delegate) {
    return {
      userId: delegate.delegateUserId,
      delegated: true,
      delegatedFromEmployeeId: approverEmployeeId,
    };
  }
  return { userId: approverUserId, delegated: false };
}
