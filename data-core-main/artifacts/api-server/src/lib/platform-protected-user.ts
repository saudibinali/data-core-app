/**
 * @phase P17-C - Protected platform administrator detection
 */

import { isRootPlatformOwner, isProtectedPlatformAccount, type PlatformUserIdentity } from "./root-platform-owner-policy";
import {
  CRITICAL_PLATFORM_PERMISSIONS,
  PLATFORM_ADMIN_PROTECTION_POLICY,
  matchesProtectedPermissionPattern,
} from "./platform-admin-protection-policy-config";
import type { PlatformPermissionCode } from "./platform-permissions";
import { getPlatformPermissionsForRole, getPlatformUserRoleCode } from "./platform-permissions";

export interface PlatformUserProtectionContext extends PlatformUserIdentity {
  platformUserType?: string | null;
  status?: string;
  isProtected?: boolean;
}

export function isPlatformOwnerUserType(userType: string | null | undefined): boolean {
  return userType === "platform_owner";
}

export function isRootOrPlatformOwner(user: PlatformUserProtectionContext): boolean {
  return isRootPlatformOwner(user) || isPlatformOwnerUserType(user.platformUserType);
}

export function userHasCriticalPermissionInRole(user: PlatformUserProtectionContext): boolean {
  const roleCode = getPlatformUserRoleCode(user);
  const perms = getPlatformPermissionsForRole(roleCode);
  return CRITICAL_PLATFORM_PERMISSIONS.some((c) => perms.has(c));
}

/**
 * Protected platform admin per P17-C:
 * - isRootOwner / legacy root
 * - isProtected flag
 * - platform_owner user type
 * - holds sensitive role permissions (disable, role update, permissions.update)
 */
export function isProtectedPlatformAdminUser(user: PlatformUserProtectionContext): boolean {
  if (isProtectedPlatformAccount(user)) return true;
  if (isPlatformOwnerUserType(user.platformUserType)) return true;
  const roleCode = getPlatformUserRoleCode(user);
  if (
    roleCode &&
    (PLATFORM_ADMIN_PROTECTION_POLICY.protectedRoleTypes as readonly string[]).includes(roleCode)
  ) {
    return true;
  }
  if (userHasCriticalPermissionInRole(user)) {
    return (
      userHasPermissionCode(user, "platform.permissions.update") ||
      userHasPermissionCode(user, "platform.users.disable") ||
      userHasPermissionCode(user, "platform.users.role.update")
    );
  }
  return false;
}

function userHasPermissionCode(
  user: PlatformUserProtectionContext,
  code: PlatformPermissionCode,
): boolean {
  const roleCode = getPlatformUserRoleCode(user);
  return getPlatformPermissionsForRole(roleCode).has(code);
}

export function permissionCodeIsProtectedPattern(code: string): boolean {
  return matchesProtectedPermissionPattern(code);
}

/** Human-readable protection reasons for access review (P17-D) */
export function getProtectionReasons(user: PlatformUserProtectionContext): string[] {
  const reasons: string[] = [];
  if (isRootPlatformOwner(user)) reasons.push("root_owner");
  if (user.isProtected) reasons.push("protected_flag");
  if (isPlatformOwnerUserType(user.platformUserType)) reasons.push("platform_owner_type");
  const roleCode = getPlatformUserRoleCode(user);
  if (
    roleCode &&
    (PLATFORM_ADMIN_PROTECTION_POLICY.protectedRoleTypes as readonly string[]).includes(roleCode)
  ) {
    reasons.push("protected_role_type");
  }
  if (userHasPermissionCode(user, "platform.permissions.update")) reasons.push("has_permissions_update");
  if (userHasPermissionCode(user, "platform.users.disable")) reasons.push("has_users_disable");
  if (userHasPermissionCode(user, "platform.users.role.update")) reasons.push("has_users_role_update");
  return [...new Set(reasons)];
}
