/**
 * P23-A — Platform governance audit + signed action metadata
 */
import { createHmac } from "node:crypto";
import { db } from "@workspace/db";
import { platformGovernanceAuditLogsTable, type PlatformGovernanceAuditLog } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { logger } from "../logger";

export type PlatformGovernanceAuditInput = {
  workspaceId?: number | null;
  actorUserId?: number | null;
  scope: "platform" | "workspace" | "support";
  action: string;
  resourceType: string;
  resourceId?: number | null;
  metadata?: Record<string, unknown>;
};

function signMetadata(payload: Record<string, unknown>): string | null {
  const secret = process.env.PLATFORM_GOVERNANCE_HMAC_SECRET;
  if (!secret) return null;
  const h = createHmac("sha256", secret);
  h.update(JSON.stringify(payload));
  return h.digest("hex");
}

export class PlatformGovernanceAuditService {
  async log(input: PlatformGovernanceAuditInput): Promise<number | null> {
    const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;
    const signature = signMetadata({
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      workspaceId: input.workspaceId ?? null,
      actorUserId: input.actorUserId ?? null,
      at: new Date().toISOString(),
      metadata: input.metadata ?? {},
    });

    try {
      const [row] = await db
        .insert(platformGovernanceAuditLogsTable)
        .values({
          workspaceId: input.workspaceId ?? null,
          actorUserId: input.actorUserId ?? null,
          scope: input.scope,
          action: input.action,
          resourceType: input.resourceType,
          resourceId: input.resourceId ?? null,
          metadataJson,
          governanceSignature: signature,
        })
        .returning({ id: platformGovernanceAuditLogsTable.id });
      return row?.id ?? null;
    } catch (err) {
      logger.warn({ err }, "[platform-governance] audit persist failed");
      return null;
    }
  }

  async listRecent(workspaceId: number | undefined, limit = 50) {
    if (workspaceId) {
      return db
        .select()
        .from(platformGovernanceAuditLogsTable)
        .where(eq(platformGovernanceAuditLogsTable.workspaceId, workspaceId))
        .orderBy(desc(platformGovernanceAuditLogsTable.createdAt))
        .limit(limit);
    }
    return db
      .select()
      .from(platformGovernanceAuditLogsTable)
      .orderBy(desc(platformGovernanceAuditLogsTable.createdAt))
      .limit(limit);
  }

  async listByAction(actions: string[], limit = 100) {
    const rows = await db
      .select()
      .from(platformGovernanceAuditLogsTable)
      .orderBy(desc(platformGovernanceAuditLogsTable.createdAt))
      .limit(limit * 2);
    return rows.filter((r: PlatformGovernanceAuditLog) => actions.includes(r.action));
  }
}

export const platformGovernanceAuditService = new PlatformGovernanceAuditService();
