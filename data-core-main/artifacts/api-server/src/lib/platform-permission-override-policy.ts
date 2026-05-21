/**
 * @phase P17-B - Protection rules for custom platform permission overrides
 */

import {
  OVERRIDE_REASON_MIN_LENGTH,
  ROOT_ONLY_GRANTABLE_PERMISSION_CODES,
  SELF_ESCALATION_BLOCKED_PREFIXES,
  LAST_OWNER_CRITICAL_PERMISSION_CODES,
  type PermissionOverrideEffect,
} from "./platform-permission-assignment-config";
import {
  isPlatformPermissionCatalogCode,
  type PlatformPermissionOverrideRow,
} from "./platform-effective-permissions";
import {
  isRootPlatformOwner,
  isProtectedPlatformAccount,
  type PlatformUserIdentity,
} from "./root-platform-owner-policy";
import type { PlatformPermissionCode } from "./platform-permissions";

export interface OverrideChangeInput {
  permissionCode: string;
  effect: PermissionOverrideEffect;
}

export function validateOverrideReason(reason: string | undefined): string | null {
  if (!reason || reason.trim().length < OVERRIDE_REASON_MIN_LENGTH) {
    return "REASON_TOO_SHORT";
  }
  return null;
}

export function isTenantOrWorkspacePermissionCode(code: string): boolean {
  if (code.startsWith("tenant.") && !code.startsWith("tenants.")) return true;
  if (code.startsWith("workspace.") && !code.startsWith("workspaces.")) return true;
  return false;
}

export function validatePermissionCodeCatalog(code: string): string | null {
  if (isTenantOrWorkspacePermissionCode(code)) return "TENANT_OR_WORKSPACE_PERMISSION_BLOCKED";
  if (!isPlatformPermissionCatalogCode(code)) return "UNKNOWN_PERMISSION_CODE";
  return null;
}

export function canActorModifyTargetOverrides(
  actor: PlatformUserIdentity,
  target: PlatformUserIdentity,
): { allowed: boolean; blockedReason?: string } {
  if (actor.id !== undefined && target.id !== undefined && actor.id === target.id) {
    return { allowed: false, blockedReason: "SELF_PERMISSION_MODIFICATION_BLOCKED" };
  }
  if (isProtectedPlatformAccount(target) && !isRootPlatformOwner(actor)) {
    return { allowed: false, blockedReason: "PROTECTED_ACCOUNT" };
  }
  if (isRootPlatformOwner(target) && !isRootPlatformOwner(actor)) {
    return { allowed: false, blockedReason: "ROOT_OWNER_IMMUTABLE" };
  }
  return { allowed: true };
}

export function canActorGrantPermissionToTarget(
  actorEffective: ReadonlySet<PlatformPermissionCode>,
  actor: PlatformUserIdentity,
  permissionCode: PlatformPermissionCode,
  effect: PermissionOverrideEffect,
): { allowed: boolean; blockedReason?: string } {
  if (effect === "deny") {
    if (
      ROOT_ONLY_GRANTABLE_PERMISSION_CODES.includes(
        permissionCode as (typeof ROOT_ONLY_GRANTABLE_PERMISSION_CODES)[number],
      ) &&
      !isRootPlatformOwner(actor)
    ) {
      return { allowed: false, blockedReason: "ROOT_ONLY_SENSITIVE_DENY" };
    }
    return { allowed: true };
  }

  if (
    ROOT_ONLY_GRANTABLE_PERMISSION_CODES.includes(
      permissionCode as (typeof ROOT_ONLY_GRANTABLE_PERMISSION_CODES)[number],
    ) &&
    !isRootPlatformOwner(actor)
  ) {
    return { allowed: false, blockedReason: "ROOT_ONLY_SENSITIVE_GRANT" };
  }

  if (!actorEffective.has(permissionCode)) {
    return { allowed: false, blockedReason: "ACTOR_LACKS_PERMISSION" };
  }

  return { allowed: true };
}

export function validateSelfEscalationOverride(
  actorId: number,
  targetId: number,
  permissionCode: string,
): string | null {
  if (actorId !== targetId) return null;
  for (const prefix of SELF_ESCALATION_BLOCKED_PREFIXES) {
    if (permissionCode.startsWith(prefix)) return "SELF_ESCALATION_BLOCKED";
  }
  return null;
}

export function validateLastOwnerCriticalDeny(
  target: PlatformUserIdentity,
  permissionCode: PlatformPermissionCode,
  effect: PermissionOverrideEffect,
  activeOwnerCount: number,
): string | null {
  if (effect !== "deny") return null;
  if (activeOwnerCount > 1) return null;
  const isOwner =
    isRootPlatformOwner(target) || target.platformUserType === "platform_owner";
  if (!isOwner) return null;
  if (
    LAST_OWNER_CRITICAL_PERMISSION_CODES.includes(
      permissionCode as (typeof LAST_OWNER_CRITICAL_PERMISSION_CODES)[number],
    )
  ) {
    return "LAST_OWNER_CRITICAL_PERMISSION_PROTECTED";
  }
  return null;
}

export function validateOverrideChange(
  actor: PlatformUserIdentity & { platformUserType?: string | null },
  target: PlatformUserIdentity & { platformUserType?: string | null },
  actorEffective: ReadonlySet<PlatformPermissionCode>,
  change: OverrideChangeInput,
  options: { activeOwnerCount: number; reason?: string },
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  const reasonErr = validateOverrideReason(options.reason);
  if (reasonErr) errors.push(reasonErr);

  const catalogErr = validatePermissionCodeCatalog(change.permissionCode);
  if (catalogErr) errors.push(catalogErr);

  const modifyCheck = canActorModifyTargetOverrides(actor, target);
  if (!modifyCheck.allowed) errors.push(modifyCheck.blockedReason ?? "MODIFY_BLOCKED");

  if (actor.id !== undefined && target.id !== undefined) {
    const selfErr = validateSelfEscalationOverride(actor.id, target.id, change.permissionCode);
    if (selfErr) errors.push(selfErr);
  }

  if (isPlatformPermissionCatalogCode(change.permissionCode)) {
    const grantCheck = canActorGrantPermissionToTarget(
      actorEffective,
      actor,
      change.permissionCode,
      change.effect,
    );
    if (!grantCheck.allowed) errors.push(grantCheck.blockedReason ?? "GRANT_BLOCKED");

    const lastOwnerErr = validateLastOwnerCriticalDeny(
      target,
      change.permissionCode,
      change.effect,
      options.activeOwnerCount,
    );
    if (lastOwnerErr) errors.push(lastOwnerErr);
  }

  return { valid: errors.length === 0, errors };
}

export function buildPermissionOverrideAuditMetadata(fields: {
  actorId?: number;
  targetPlatformUserId?: number;
  permissionCode?: string;
  effect?: string;
  previousEffect?: string | null;
  nextEffect?: string | null;
  reason?: string;
}): Record<string, unknown> {
  return {
    actorId: fields.actorId,
    targetPlatformUserId: fields.targetPlatformUserId,
    permissionCode: fields.permissionCode,
    effect: fields.effect,
    previousEffect: fields.previousEffect,
    nextEffect: fields.nextEffect,
    reason: fields.reason,
    timestamp: new Date().toISOString(),
  };
}
