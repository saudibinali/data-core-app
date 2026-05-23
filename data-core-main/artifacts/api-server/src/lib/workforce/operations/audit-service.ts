import { db } from "@workspace/db";
import { workforceAuditLogTable } from "@workspace/db";

export type AuditInput = {
  workspaceId: number;
  entityType: string;
  entityId: number;
  action: string;
  actorUserId?: number | null;
  beforeState?: unknown;
  afterState?: unknown;
  correlationId?: string | null;
};

export async function recordWorkforceAudit(input: AuditInput): Promise<void> {
  await db.insert(workforceAuditLogTable).values({
    workspaceId: input.workspaceId,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    actorUserId: input.actorUserId ?? null,
    beforeState: input.beforeState ?? null,
    afterState: input.afterState ?? null,
    correlationId: input.correlationId ?? null,
  }).catch(() => undefined);
}
