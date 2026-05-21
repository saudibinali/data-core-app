import { db } from "@workspace/db";
import { communicationAuditLogsTable } from "@workspace/db";

export async function logCommunicationAudit(params: {
  workspaceId: number;
  action: string;
  actorUserId?: number | null;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}): Promise<void> {
  await db.insert(communicationAuditLogsTable).values({
    workspaceId: params.workspaceId,
    action: params.action,
    actorUserId: params.actorUserId ?? null,
    targetType: params.targetType ?? null,
    targetId: params.targetId ?? null,
    metadataJson: params.metadata ? JSON.stringify(params.metadata) : null,
    ipAddress: params.ipAddress ?? null,
  });
}
