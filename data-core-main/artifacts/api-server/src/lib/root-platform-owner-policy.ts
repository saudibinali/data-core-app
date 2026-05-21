/**
 * root-platform-owner-policy.ts
 *
 * P14-A - Pure policy library for Platform User management and Root Platform Owner protection.
 * No DB, no HTTP, no side effects. Fully deterministic and unit-testable.
 *
 * SAFETY: Every function in this file is advisory / guard only.
 *         No mutations are performed here.
 */

// ── Protection Policy ─────────────────────────────────────────────────────────

export const ROOT_PLATFORM_OWNER_PROTECTION_POLICY = {
  root_platform_owner: true,
  protected_account: true,
  immutable_role: true,
  non_deletable: true,
  non_disableable: true,
  non_lockable: true,
  password_reset_blocked_from_admin_ui: true,
  email_change_blocked: true,
  self_promotion_blocked: true,
  root_role_assignment_blocked: true,
  cannot_manage_equal_or_higher_privilege: true,
  cannot_disable_last_root_owner: true,
  requires_break_glass_recovery: true,
  audit_required: true,
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export type PlatformUserStatus = "invited" | "active" | "disabled" | "suspended" | "locked";
export type InitialPlatformRoleCode =
  | "root_platform_owner"
  | "platform_admin"
  | "support_admin"
  | "workspace_support"
  | "sales_admin"
  | "finance_admin"
  | "auditor"
  | "read_only_operator";

export interface PlatformUserIdentity {
  id?: number;
  email?: string | null;
  role?: string;
  workspaceId?: number | null;
  isRootOwner?: boolean;
  isProtected?: boolean;
  platformRoleCode?: string | null;
  platformUserType?: string | null;
}

export interface BlockedActionAuditEvent {
  actorId: number | undefined;
  actorEmail: string | null | undefined;
  targetUserId: number | undefined;
  targetEmail: string | null | undefined;
  action: string;
  result: "blocked";
  blockedReason: string;
  timestamp: string;
}

export interface PolicyCheckResult {
  allowed: boolean;
  blockedReason?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const PLATFORM_USER_REASON_MIN_LENGTH = 10;

export const BLOCKED_ROLE_CODES_FROM_UI: readonly string[] = ["root_platform_owner"];

export const ALL_ASSIGNABLE_PLATFORM_ROLE_CODES: readonly InitialPlatformRoleCode[] = [
  "platform_admin",
  "support_admin",
  "workspace_support",
  "sales_admin",
  "finance_admin",
  "auditor",
  "read_only_operator",
];

export const ALL_INITIAL_PLATFORM_ROLE_CODES: readonly InitialPlatformRoleCode[] = [
  "root_platform_owner",
  ...ALL_ASSIGNABLE_PLATFORM_ROLE_CODES,
];

export const ALL_PLATFORM_USER_STATUSES: readonly PlatformUserStatus[] = [
  "invited",
  "active",
  "disabled",
  "suspended",
  "locked",
];

export const MUTABLE_PLATFORM_USER_STATUSES: readonly PlatformUserStatus[] = [
  "active",
  "disabled",
  "suspended",
  "locked",
];

// ── Role privilege hierarchy (lower = more privileged) ────────────────────────

const ROLE_PRIVILEGE: Record<string, number> = {
  root_platform_owner: 0,
  platform_admin: 1,
  support_admin: 2,
  workspace_support: 3,
  sales_admin: 3,
  finance_admin: 3,
  auditor: 4,
  read_only_operator: 5,
};

function getPrivilege(roleCode: string | null | undefined): number {
  if (!roleCode) return 0; // null platformRoleCode = root_platform_owner level
  return ROLE_PRIVILEGE[roleCode] ?? 99;
}

// ── Core predicates ───────────────────────────────────────────────────────────

/**
 * A user is the Root Platform Owner if:
 *   - isRootOwner flag is explicitly true, OR
 *   - backward-compat: role = "super_admin" + no workspace + no platformRoleCode
 *     (the original seeded admin account before P14-A migration)
 */
export function isRootPlatformOwner(user: PlatformUserIdentity): boolean {
  if (user.isRootOwner === true) return true;
  return (
    user.role === "super_admin" &&
    (user.workspaceId === null || user.workspaceId === undefined) &&
    (user.platformRoleCode === null || user.platformRoleCode === undefined)
  );
}

/**
 * A user is a protected platform account if:
 *   - isProtected flag is explicitly true, OR
 *   - they are the Root Platform Owner (always protected)
 */
export function isProtectedPlatformAccount(user: PlatformUserIdentity): boolean {
  return user.isProtected === true || isRootPlatformOwner(user);
}

/**
 * Returns true if the target role code is assignable from the standard UI.
 * root_platform_owner is always blocked.
 */
export function isAssignableRoleCode(roleCode: string): boolean {
  if (roleCode === "root_platform_owner") return false;
  return ALL_ASSIGNABLE_PLATFORM_ROLE_CODES.includes(roleCode as InitialPlatformRoleCode);
}

// ── Guard functions ───────────────────────────────────────────────────────────

export function canAssignPlatformRole(
  actor: PlatformUserIdentity,
  targetRole: string,
): PolicyCheckResult {
  if (targetRole === "root_platform_owner") {
    return { allowed: false, blockedReason: "ROOT_ROLE_ASSIGNMENT_BLOCKED" };
  }
  if (!isAssignableRoleCode(targetRole)) {
    return { allowed: false, blockedReason: "UNKNOWN_ROLE_CODE" };
  }
  const actorPrivilege = isRootPlatformOwner(actor) ? 0 : getPrivilege(actor.platformRoleCode);
  const targetPrivilege = getPrivilege(targetRole);
  if (actorPrivilege >= targetPrivilege) {
    return { allowed: false, blockedReason: "EQUAL_OR_HIGHER_PRIVILEGE" };
  }
  return { allowed: true };
}

export function canManagePlatformUser(
  actor: PlatformUserIdentity,
  targetUser: PlatformUserIdentity,
): PolicyCheckResult {
  if (actor.id !== undefined && targetUser.id !== undefined && actor.id === targetUser.id) {
    return { allowed: false, blockedReason: "SELF_MANAGEMENT_BLOCKED" };
  }
  if (isProtectedPlatformAccount(targetUser) && !isRootPlatformOwner(actor)) {
    return { allowed: false, blockedReason: "PROTECTED_ACCOUNT" };
  }
  if (isProtectedPlatformAccount(targetUser) && isRootPlatformOwner(actor)) {
    return { allowed: false, blockedReason: "PROTECTED_ROOT_OWNER_IMMUTABLE" };
  }
  const actorPrivilege = isRootPlatformOwner(actor) ? 0 : getPrivilege(actor.platformRoleCode);
  const targetPrivilege = isRootPlatformOwner(targetUser) ? 0 : getPrivilege(targetUser.platformRoleCode);
  if (actorPrivilege >= targetPrivilege) {
    return { allowed: false, blockedReason: "EQUAL_OR_HIGHER_PRIVILEGE" };
  }
  return { allowed: true };
}

export function canChangePlatformUserStatus(
  actor: PlatformUserIdentity,
  targetUser: PlatformUserIdentity,
  nextStatus: string,
): PolicyCheckResult {
  if (isProtectedPlatformAccount(targetUser)) {
    return { allowed: false, blockedReason: "PROTECTED_ROOT_OWNER_IMMUTABLE" };
  }
  return canManagePlatformUser(actor, targetUser);
}

export function canResetPlatformUserPasswordFromAdmin(
  _actor: PlatformUserIdentity,
  targetUser: PlatformUserIdentity,
): PolicyCheckResult {
  if (isProtectedPlatformAccount(targetUser)) {
    return { allowed: false, blockedReason: "ROOT_PASSWORD_RESET_BLOCKED" };
  }
  return { allowed: true };
}

export function canChangePlatformUserEmail(
  _actor: PlatformUserIdentity,
  targetUser: PlatformUserIdentity,
): PolicyCheckResult {
  if (isProtectedPlatformAccount(targetUser)) {
    return { allowed: false, blockedReason: "ROOT_EMAIL_CHANGE_BLOCKED" };
  }
  return { allowed: true };
}

// ── Validation ────────────────────────────────────────────────────────────────

export interface PlatformUserCreatePayload {
  email?: string;
  displayName?: string;
  roleCode?: string;
}

export function validatePlatformUserCreate(
  actor: PlatformUserIdentity,
  payload: PlatformUserCreatePayload,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!payload.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email.trim())) {
    errors.push("INVALID_EMAIL");
  }

  if (!payload.displayName || payload.displayName.trim().length < 2) {
    errors.push("DISPLAY_NAME_REQUIRED");
  }

  if (!payload.roleCode) {
    errors.push("ROLE_CODE_REQUIRED");
  } else if (payload.roleCode === "root_platform_owner") {
    errors.push("ROOT_ROLE_ASSIGNMENT_BLOCKED");
  } else if (!isAssignableRoleCode(payload.roleCode)) {
    errors.push("UNKNOWN_ROLE_CODE");
  } else {
    const assignCheck = canAssignPlatformRole(actor, payload.roleCode);
    if (!assignCheck.allowed) {
      errors.push(assignCheck.blockedReason ?? "ROLE_ASSIGNMENT_BLOCKED");
    }
  }

  return { valid: errors.length === 0, errors };
}

export interface PlatformUserStatusChangePayload {
  nextStatus?: string;
  reason?: string;
  confirmation?: boolean;
}

export function validatePlatformUserStatusChange(
  actor: PlatformUserIdentity,
  targetUser: PlatformUserIdentity,
  payload: PlatformUserStatusChangePayload,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  const statusCheck = canChangePlatformUserStatus(actor, targetUser, payload.nextStatus ?? "");
  if (!statusCheck.allowed) {
    errors.push(statusCheck.blockedReason ?? "STATUS_CHANGE_BLOCKED");
  }

  if (!payload.nextStatus || !MUTABLE_PLATFORM_USER_STATUSES.includes(payload.nextStatus as PlatformUserStatus)) {
    errors.push("UNKNOWN_STATUS");
  }

  if (!payload.reason || payload.reason.trim().length < PLATFORM_USER_REASON_MIN_LENGTH) {
    errors.push("REASON_TOO_SHORT");
  }

  if (!payload.confirmation) {
    errors.push("CONFIRMATION_REQUIRED");
  }

  return { valid: errors.length === 0, errors };
}

// ── Audit event builder ───────────────────────────────────────────────────────

export function buildBlockedPlatformUserActionAuditEvent(
  actor: PlatformUserIdentity,
  targetUser: PlatformUserIdentity,
  action: string,
  blockedReason: string,
): BlockedActionAuditEvent {
  return {
    actorId: actor.id,
    actorEmail: actor.email,
    targetUserId: targetUser.id,
    targetEmail: targetUser.email,
    action,
    result: "blocked",
    blockedReason,
    timestamp: new Date().toISOString(),
  };
}
