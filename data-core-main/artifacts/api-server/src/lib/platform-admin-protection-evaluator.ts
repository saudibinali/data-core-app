/**
 * @phase P17-C - Central platform admin protection evaluator
 */

import {
  PLATFORM_ADMIN_PROTECTION_POLICY,
  SENSITIVE_CHANGE_REASON_MIN_LENGTH,
  isCriticalPlatformPermission,
  getSafePolicySnapshot,
  type ProtectionSeverity,
  type ProtectionBlockedReasonCode,
} from "./platform-admin-protection-policy-config";
import {
  isProtectedPlatformAdminUser,
  type PlatformUserProtectionContext,
} from "./platform-protected-user";
import { isRootPlatformOwner } from "./root-platform-owner-policy";
import { isPlatformOwnerAccount } from "./platform-user-lifecycle";
import type { PlatformPermissionCode } from "./platform-permissions";

export type PlatformAdminProtectionAction =
  | "disable_user"
  | "suspend_user"
  | "reactivate_user"
  | "change_role"
  | "update_permission_override"
  | "bulk_update_permission_overrides"
  | "clear_permission_override"
  | "update_root_owner_flag"
  | "update_own_profile_sensitive";

export interface PlatformAdminProtectionPayload {
  nextStatus?: string;
  nextRoleCode?: string;
  permissionCode?: string;
  effect?: "grant" | "deny";
  reason?: string;
  confirmation?: boolean;
  isRootOwner?: boolean;
}

export interface PlatformAdminProtectionEvaluation {
  allowed: boolean;
  blockedReason: ProtectionBlockedReasonCode;
  severity: ProtectionSeverity;
  requiredReason: boolean;
  requiredApproval: boolean;
  policySnapshot: Record<string, unknown>;
  warnings: string[];
}

function baseResult(
  partial: Partial<PlatformAdminProtectionEvaluation> & { allowed: boolean; blockedReason: ProtectionBlockedReasonCode },
): PlatformAdminProtectionEvaluation {
  return {
    severity: partial.severity ?? (partial.allowed ? "low" : "high"),
    requiredReason: partial.requiredReason ?? false,
    requiredApproval: partial.requiredApproval ?? false,
    policySnapshot: getSafePolicySnapshot(),
    warnings: partial.warnings ?? [],
    ...partial,
  };
}

function isDeactivatingStatus(status: string | undefined): boolean {
  return status === "disabled" || status === "suspended" || status === "locked";
}

function reasonValid(reason: string | undefined): boolean {
  return Boolean(reason && reason.trim().length >= SENSITIVE_CHANGE_REASON_MIN_LENGTH);
}

function isSensitiveAction(action: PlatformAdminProtectionAction, payload: PlatformAdminProtectionPayload): boolean {
  const policy = PLATFORM_ADMIN_PROTECTION_POLICY;
  if (!policy.requireReasonForSensitiveChanges) return false;
  if (
    action === "disable_user" ||
    action === "suspend_user" ||
    action === "change_role" ||
    action === "update_permission_override" ||
    action === "bulk_update_permission_overrides" ||
    action === "clear_permission_override"
  ) {
    return true;
  }
  if (action === "update_permission_override" && payload.permissionCode) {
    return isCriticalPlatformPermission(payload.permissionCode) || payload.effect === "deny";
  }
  return false;
}

export interface EvaluatePlatformAdminProtectionInput {
  action: PlatformAdminProtectionAction;
  actor: PlatformUserProtectionContext;
  target: PlatformUserProtectionContext;
  activeRootOwnerCount: number;
  activePlatformOwnerCount: number;
  payload?: PlatformAdminProtectionPayload;
}

export function evaluatePlatformAdminProtection(
  input: EvaluatePlatformAdminProtectionInput,
): PlatformAdminProtectionEvaluation {
  const { action, actor, target, activeRootOwnerCount, activePlatformOwnerCount } = input;
  const payload = input.payload ?? {};
  const policy = PLATFORM_ADMIN_PROTECTION_POLICY;
  const warnings: string[] = [];

  if (!policy.isActive) {
    return baseResult({ allowed: true, blockedReason: "ALLOWED", severity: "low" });
  }

  if (action === "update_root_owner_flag" || payload.isRootOwner !== undefined) {
    return baseResult({
      allowed: false,
      blockedReason: "ROOT_OWNER_FLAG_IMMUTABLE",
      severity: "critical",
    });
  }

  const actorId = actor.id;
  const targetId = target.id;
  const isSelf = actorId !== undefined && targetId !== undefined && actorId === targetId;

  const targetIsRoot = isRootPlatformOwner(target);
  const targetIsProtected = isProtectedPlatformAdminUser(target);
  const actorIsRoot = isRootPlatformOwner(actor);

  if (isSensitiveAction(action, payload) && !reasonValid(payload.reason)) {
    return baseResult({
      allowed: false,
      blockedReason: "REASON_REQUIRED",
      severity: "medium",
      requiredReason: true,
    });
  }

  if (
    (action === "disable_user" || action === "suspend_user" || action === "change_role") &&
    payload.confirmation !== true &&
    isSensitiveAction(action, payload)
  ) {
    return baseResult({
      allowed: false,
      blockedReason: "CONFIRMATION_REQUIRED",
      severity: "medium",
      requiredReason: true,
    });
  }

  if (isSelf && policy.preventSelfDisable && (action === "disable_user" || action === "suspend_user")) {
    return baseResult({
      allowed: false,
      blockedReason: "SELF_DISABLE_BLOCKED",
      severity: "critical",
    });
  }

  if (
    isSelf &&
    policy.preventSelfDemotion &&
    action === "change_role" &&
    payload.nextRoleCode &&
    payload.nextRoleCode !== target.platformRoleCode
  ) {
    return baseResult({
      allowed: false,
      blockedReason: "SELF_DEMOTION_BLOCKED",
      severity: "critical",
    });
  }

  if (
    isSelf &&
    (action === "update_permission_override" ||
      action === "bulk_update_permission_overrides" ||
      action === "clear_permission_override")
  ) {
    return baseResult({
      allowed: false,
      blockedReason: "SELF_PERMISSION_MODIFICATION_BLOCKED",
      severity: "critical",
    });
  }

  if ((targetIsRoot || targetIsProtected) && !actorIsRoot) {
    return baseResult({
      allowed: false,
      blockedReason: targetIsRoot ? "ROOT_OWNER_IMMUTABLE" : "PROTECTED_USER_REQUIRES_ROOT",
      severity: "critical",
    });
  }

  if (
    policy.preventLastOwnerDisable &&
    action === "change_role" &&
    payload.nextRoleCode &&
    payload.nextRoleCode !== target.platformRoleCode
  ) {
    if (
      isRootPlatformOwner(target) &&
      activeRootOwnerCount <= policy.minActiveRootOwners &&
      payload.nextRoleCode !== "root_platform_owner"
    ) {
      return baseResult({
        allowed: false,
        blockedReason: "LAST_ROOT_OWNER_BLOCKED",
        severity: "critical",
      });
    }
    if (
      isPlatformOwnerAccount(target) &&
      activePlatformOwnerCount <= policy.minActivePlatformOwners &&
      payload.nextRoleCode !== "platform_admin" &&
      payload.nextRoleCode !== "root_platform_owner"
    ) {
      return baseResult({
        allowed: false,
        blockedReason: "LAST_PLATFORM_OWNER_BLOCKED",
        severity: "critical",
      });
    }
  }

  if (
    policy.preventLastOwnerDisable &&
    (action === "disable_user" || action === "suspend_user") &&
    isDeactivatingStatus(payload.nextStatus ?? (action === "suspend_user" ? "suspended" : "disabled"))
  ) {
    if (isRootPlatformOwner(target) && activeRootOwnerCount <= policy.minActiveRootOwners) {
      return baseResult({
        allowed: false,
        blockedReason: "LAST_ROOT_OWNER_BLOCKED",
        severity: "critical",
      });
    }
    if (isPlatformOwnerAccount(target) && activePlatformOwnerCount <= policy.minActivePlatformOwners) {
      return baseResult({
        allowed: false,
        blockedReason: "LAST_PLATFORM_OWNER_BLOCKED",
        severity: "critical",
      });
    }
  }

  if (
    policy.preventLastOwnerCriticalPermissionDeny &&
    (action === "update_permission_override" ||
      action === "bulk_update_permission_overrides" ||
      action === "clear_permission_override")
  ) {
    const code = payload.permissionCode;
    const effect = payload.effect;
    if (code && effect === "deny" && isCriticalPlatformPermission(code)) {
      if (
        isRootPlatformOwner(target) &&
        activeRootOwnerCount <= policy.minActiveRootOwners
      ) {
        return baseResult({
          allowed: false,
          blockedReason: "CRITICAL_PERMISSION_DENY_BLOCKED",
          severity: "critical",
        });
      }
      if (
        isPlatformOwnerAccount(target) &&
        activePlatformOwnerCount <= policy.minActivePlatformOwners
      ) {
        return baseResult({
          allowed: false,
          blockedReason: "CRITICAL_PERMISSION_DENY_BLOCKED",
          severity: "critical",
        });
      }
    }
    if (
      action === "clear_permission_override" &&
      code &&
      isCriticalPlatformPermission(code) &&
      (isRootPlatformOwner(target) || isPlatformOwnerAccount(target)) &&
      (activeRootOwnerCount <= policy.minActiveRootOwners ||
        activePlatformOwnerCount <= policy.minActivePlatformOwners)
    ) {
      warnings.push("Clearing critical override on last owner — allowed only if not deny");
    }
  }

  if (policy.requireTwoStepApprovalForRootChanges && targetIsRoot) {
    warnings.push("Two-step approval not implemented in P17-C");
  }

  const requiredReason = isSensitiveAction(action, payload);
  const requiredApproval =
    policy.requireTwoStepApprovalForRootChanges && targetIsRoot && isSensitiveAction(action, payload);

  return baseResult({
    allowed: true,
    blockedReason: "ALLOWED",
    severity: requiredReason ? "medium" : "low",
    requiredReason,
    requiredApproval,
    warnings,
  });
}

export function resolveStatusProtectionAction(nextStatus: string): PlatformAdminProtectionAction {
  if (nextStatus === "active") return "reactivate_user";
  if (nextStatus === "suspended") return "suspend_user";
  if (nextStatus === "disabled" || nextStatus === "locked") return "disable_user";
  return "disable_user";
}

export function buildProtectionAuditMetadata(
  evaluation: PlatformAdminProtectionEvaluation,
  fields: {
    actorId?: number;
    targetUserId?: number;
    action: string;
    reason?: string;
  },
): Record<string, unknown> {
  return {
    actorId: fields.actorId,
    targetUserId: fields.targetUserId,
    action: fields.action,
    blockedReason: evaluation.blockedReason,
    severity: evaluation.severity,
    requiredReason: evaluation.requiredReason,
    requiredApproval: evaluation.requiredApproval,
    reason: fields.reason,
    timestamp: new Date().toISOString(),
  };
}

export function protectionAuditActionForBlocked(
  evaluation: PlatformAdminProtectionEvaluation,
): string {
  if (evaluation.blockedReason === "ROOT_OWNER_FLAG_IMMUTABLE") {
    return "platform_root_owner_change_blocked";
  }
  if (
    evaluation.blockedReason === "LAST_ROOT_OWNER_BLOCKED" ||
    evaluation.blockedReason === "LAST_PLATFORM_OWNER_BLOCKED"
  ) {
    return "platform_last_owner_action_blocked";
  }
  if (evaluation.allowed && evaluation.requiredReason) {
    return "platform_admin_sensitive_change_allowed";
  }
  if (!evaluation.allowed) {
    if (
      evaluation.blockedReason === "CRITICAL_PERMISSION_DENY_BLOCKED" ||
      evaluation.blockedReason === "SELF_PERMISSION_MODIFICATION_BLOCKED"
    ) {
      return "platform_admin_sensitive_change_blocked";
    }
    return "platform_admin_protection_evaluated_blocked";
  }
  if (evaluation.warnings.length > 0) {
    return "platform_admin_protection_warning";
  }
  return "platform_admin_sensitive_change_allowed";
}
