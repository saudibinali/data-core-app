/**
 * @phase P17-A - Platform user directory lifecycle validation (pure + policy)
 */

import {
  isRootPlatformOwner,
  isProtectedPlatformAccount,
  canManagePlatformUser,
  canAssignPlatformRole,
  PLATFORM_USER_REASON_MIN_LENGTH,
  type PlatformUserIdentity,
} from "./root-platform-owner-policy";
import {
  PLATFORM_USER_TYPES,
  PLATFORM_DIRECTORY_STATUSES,
  USER_TYPE_TO_DEFAULT_ROLE,
  type PlatformUserType,
  type PlatformDirectoryStatus,
} from "./platform-user-directory-config";

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizePlatformUserEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidPlatformUserEmail(email: string): boolean {
  return EMAIL_REGEX.test(normalizePlatformUserEmail(email));
}

export function userTypeToRoleCode(userType: PlatformUserType): string | null {
  if (userType === "platform_owner") return null;
  return USER_TYPE_TO_DEFAULT_ROLE[userType];
}

export function isPlatformOwnerAccount(user: PlatformUserIdentity & { platformUserType?: string | null }): boolean {
  if (user.platformUserType === "platform_owner") return true;
  return isRootPlatformOwner(user);
}

export interface PlatformUserDirectoryCreatePayload {
  email?: string;
  displayName?: string;
  userType?: string;
  roleCode?: string;
  jobTitle?: string;
  department?: string;
  phone?: string;
}

export function validatePlatformUserDirectoryCreate(
  actor: PlatformUserIdentity,
  payload: PlatformUserDirectoryCreatePayload,
): { valid: boolean; errors: string[]; normalizedEmail?: string; roleCode?: string; userType?: PlatformUserType } {
  const errors: string[] = [];

  if (!payload.email || !isValidPlatformUserEmail(payload.email)) {
    errors.push("INVALID_EMAIL");
  }

  if (!payload.displayName || payload.displayName.trim().length < 2) {
    errors.push("DISPLAY_NAME_REQUIRED");
  }

  let userType: PlatformUserType | undefined;
  if (payload.userType) {
    if (!PLATFORM_USER_TYPES.includes(payload.userType as PlatformUserType)) {
      errors.push("UNKNOWN_USER_TYPE");
    } else {
      userType = payload.userType as PlatformUserType;
    }
  }

  let roleCode = payload.roleCode;
  if (userType) {
    if (userType === "platform_owner") {
      errors.push("PLATFORM_OWNER_CREATE_BLOCKED");
    } else {
      roleCode = userTypeToRoleCode(userType) ?? undefined;
    }
  }

  if (!userType && !roleCode) {
    errors.push("USER_TYPE_OR_ROLE_REQUIRED");
  }

  if (roleCode === "root_platform_owner") {
    errors.push("ROOT_ROLE_ASSIGNMENT_BLOCKED");
  }

  if (roleCode && userType !== "platform_owner") {
    const assignCheck = canAssignPlatformRole(actor, roleCode);
    if (!assignCheck.allowed) {
      errors.push(assignCheck.blockedReason ?? "ROLE_ASSIGNMENT_BLOCKED");
    }
  }

  const normalizedEmail =
    payload.email && isValidPlatformUserEmail(payload.email)
      ? normalizePlatformUserEmail(payload.email)
      : undefined;

  return {
    valid: errors.length === 0,
    errors,
    normalizedEmail,
    roleCode,
    userType,
  };
}

export interface PlatformUserProfileUpdatePayload {
  displayName?: string;
  jobTitle?: string | null;
  department?: string | null;
  phone?: string | null;
  email?: string;
  isRootOwner?: boolean;
}

export function validatePlatformUserProfileUpdate(
  payload: PlatformUserProfileUpdatePayload,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (payload.email !== undefined) {
    errors.push("EMAIL_UPDATE_NOT_SUPPORTED");
  }
  if (payload.isRootOwner !== undefined) {
    errors.push("ROOT_OWNER_FLAG_IMMUTABLE");
  }
  if (payload.displayName !== undefined && payload.displayName.trim().length < 2) {
    errors.push("DISPLAY_NAME_REQUIRED");
  }

  const hasProfileField =
    payload.displayName !== undefined ||
    payload.jobTitle !== undefined ||
    payload.department !== undefined ||
    payload.phone !== undefined;

  if (!hasProfileField) {
    errors.push("NO_PROFILE_FIELDS");
  }

  return { valid: errors.length === 0, errors };
}

export interface PlatformSelfProfileUpdatePayload {
  displayName?: string;
  jobTitle?: string | null;
  department?: string | null;
  phone?: string | null;
}

export function validatePlatformSelfProfileUpdate(
  payload: PlatformSelfProfileUpdatePayload,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (payload.displayName !== undefined && payload.displayName.trim().length < 2) {
    errors.push("DISPLAY_NAME_REQUIRED");
  }

  const hasProfileField =
    payload.displayName !== undefined ||
    payload.jobTitle !== undefined ||
    payload.department !== undefined ||
    payload.phone !== undefined;

  if (!hasProfileField) {
    errors.push("NO_PROFILE_FIELDS");
  }

  return { valid: errors.length === 0, errors };
}

export interface PlatformSelfEmailUpdatePayload {
  email?: string;
  currentPassword?: string;
}

export function validatePlatformSelfEmailUpdate(
  payload: PlatformSelfEmailUpdatePayload,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!payload.currentPassword || String(payload.currentPassword).length < 1) {
    errors.push("CURRENT_PASSWORD_REQUIRED");
  }
  if (!payload.email || !isValidPlatformUserEmail(payload.email)) {
    errors.push("INVALID_EMAIL");
  }

  return { valid: errors.length === 0, errors };
}

export interface PlatformUserDirectoryStatusPayload {
  nextStatus?: string;
  reason?: string;
  confirmation?: boolean;
}

const DEACTIVATING_STATUSES: readonly PlatformDirectoryStatus[] = ["disabled", "suspended", "locked"];

export function resolveStatusPermission(
  nextStatus: string,
): "platform.users.reactivate" | "platform.users.disable" {
  return nextStatus === "active" ? "platform.users.reactivate" : "platform.users.disable";
}

export function resolveStatusAuditAction(nextStatus: string): string {
  if (nextStatus === "active") return "platform_user_reactivated";
  if (nextStatus === "suspended") return "platform_user_suspended";
  if (nextStatus === "disabled") return "platform_user_disabled";
  return "platform_user_status_changed";
}

export function validatePlatformUserDirectoryStatusChange(
  actor: PlatformUserIdentity,
  targetUser: PlatformUserIdentity & { platformUserType?: string | null; status?: string },
  payload: PlatformUserDirectoryStatusPayload,
  options: { activeOwnerCount: number },
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const nextStatus = payload.nextStatus ?? "";

  if (!nextStatus || !PLATFORM_DIRECTORY_STATUSES.includes(nextStatus as PlatformDirectoryStatus)) {
    errors.push("UNKNOWN_STATUS");
  }

  if (nextStatus === "invited") {
    errors.push("INVITED_STATUS_NOT_ALLOWED_VIA_API");
  }

  if (!payload.reason || payload.reason.trim().length < PLATFORM_USER_REASON_MIN_LENGTH) {
    errors.push("REASON_TOO_SHORT");
  }

  if (!payload.confirmation) {
    errors.push("CONFIRMATION_REQUIRED");
  }

  if (isProtectedPlatformAccount(targetUser)) {
    if (!isRootPlatformOwner(actor)) {
      errors.push("PROTECTED_ACCOUNT");
    } else {
      errors.push("PROTECTED_ROOT_OWNER_IMMUTABLE");
    }
  }

  const manageCheck = canManagePlatformUser(actor, targetUser);
  if (!manageCheck.allowed && !errors.includes("PROTECTED_ACCOUNT")) {
    errors.push(manageCheck.blockedReason ?? "STATUS_CHANGE_BLOCKED");
  }

  if (DEACTIVATING_STATUSES.includes(nextStatus as PlatformDirectoryStatus)) {
    if (isPlatformOwnerAccount(targetUser) && options.activeOwnerCount <= 1) {
      errors.push("LAST_ACTIVE_OWNER_PROTECTED");
    }
    if (
      actor.id !== undefined &&
      targetUser.id !== undefined &&
      actor.id === targetUser.id &&
      isPlatformOwnerAccount(targetUser) &&
      options.activeOwnerCount <= 1
    ) {
      errors.push("CANNOT_DISABLE_SELF_AS_LAST_OWNER");
    }
  }

  return { valid: errors.length === 0, errors };
}

export function buildPlatformUserLifecycleAuditMetadata(fields: {
  actorId?: number;
  targetPlatformUserId?: number;
  email?: string | null;
  previousStatus?: string;
  nextStatus?: string;
  userType?: string | null;
  reason?: string;
}): Record<string, unknown> {
  return {
    actorId: fields.actorId,
    targetPlatformUserId: fields.targetPlatformUserId,
    email: fields.email,
    previousStatus: fields.previousStatus,
    nextStatus: fields.nextStatus,
    userType: fields.userType,
    reason: fields.reason,
    timestamp: new Date().toISOString(),
  };
}
