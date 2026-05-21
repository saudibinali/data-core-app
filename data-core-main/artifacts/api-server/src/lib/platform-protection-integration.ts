/**
 * @phase P17-C - Route integration helpers for protection evaluator + audit
 */

import { activityLogsTable } from "@workspace/db";
import { db } from "@workspace/db";
import {
  evaluatePlatformAdminProtection,
  buildProtectionAuditMetadata,
  protectionAuditActionForBlocked,
  type PlatformAdminProtectionAction,
  type PlatformAdminProtectionEvaluation,
  type PlatformAdminProtectionPayload,
} from "./platform-admin-protection-evaluator";
import type { PlatformUserProtectionContext } from "./platform-protected-user";
import { countActivePlatformOwners } from "./platform-owner-counts";

export async function evaluateAndAuditPlatformProtection(
  params: {
    action: PlatformAdminProtectionAction;
    actor: PlatformUserProtectionContext;
    target: PlatformUserProtectionContext;
    payload?: PlatformAdminProtectionPayload;
    actorId?: number;
  },
): Promise<PlatformAdminProtectionEvaluation> {
  const counts = await countActivePlatformOwners();
  const evaluation = evaluatePlatformAdminProtection({
    action: params.action,
    actor: params.actor,
    target: params.target,
    activeRootOwnerCount: counts.activeRootOwnerCount,
    activePlatformOwnerCount: counts.activePlatformOwnerCount,
    payload: params.payload,
  });

  const auditAction = protectionAuditActionForBlocked(evaluation);
  const shouldAudit =
    !evaluation.allowed ||
    evaluation.requiredReason ||
    evaluation.warnings.length > 0;
  if (shouldAudit) {
    await db.insert(activityLogsTable).values({
      userId: params.actorId ?? null,
      action: auditAction,
      metadata: JSON.stringify(
        buildProtectionAuditMetadata(evaluation, {
          actorId: params.actorId,
          targetUserId: params.target.id,
          action: params.action,
          reason: params.payload?.reason,
        }),
      ),
      workspaceId: null,
    });
  }

  return evaluation;
}
