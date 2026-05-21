/**
 * platform-access.ts
 *
 * @phase P14-C - Platform Access Boundary & Route Guards
 *
 * Pure client-side permission helpers for the Platform Administration UI.
 * No React, no hooks, no network calls - only deterministic derivations.
 *
 * Source of truth for authorization remains the backend.
 * These helpers prevent the "button visible → backend rejects" UX gap.
 *
 * SAFETY:
 *   - Root (isRootOwner OR legacy root) always sees and can do everything.
 *   - Unknown/non-platform roles see nothing.
 *   - Governance section is out-of-scope - kept as SuperAdminRoute.
 *   - No custom roles, no permission editor, no break-glass.
 */

import {
  PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG,
  type PlatformPermissionCode,
  type PlatformRoleCode,
} from "./platform-permissions-config";
import type { ConsoleTab } from "./tenant-admin-console-config";

// ── Minimal user shape ────────────────────────────────────────────────────────

export interface MinimalPlatformUser {
  role?: string;
  platformRoleCode?: string | null;
  isRootOwner?: boolean;
  workspaceId?: number | null;
}

// ── Route / Nav / Action key types ───────────────────────────────────────────

export type PlatformRouteKey =
  | "platform.users"
  | "tenant.registry"
  | "tenant.console.overview"
  | "tenant.console.lifecycle"
  | "tenant.console.subscription"
  | "tenant.console.entitlements"
  | "tenant.console.usage"
  | "tenant.console.renewal"
  | "tenant.console.health"
  | "tenant.console.evaluation"
  | "platform.activity"
  | "audit";

export type PlatformNavItemKey =
  | "overview"
  | "workspaces"
  | "tenant-registry"
  | "commercial-risk"
  | "platform-users"
  | "access-review"
  | "platform-activity"
  | "event-log"
  | "platform-settings"
  | "platform-ops";

export type PlatformActionKey =
  | "platform.user.create"
  | "platform.user.update"
  | "platform.user.disable"
  | "platform.user.reactivate"
  | "platform.user.status.update"
  | "platform.user.role.update"
  | "tenant.lifecycle.update"
  | "tenant.subscription.update"
  | "tenant.workspace_subscription.update"
  | "tenant.workspace_subscription.status.change"
  | "tenant.workspace_entitlements.update"
  | "tenant.workspace_quotas.update"
  | "tenant.workspace_subscription_policies.update"
  | "tenant.workspace_access.update"
  | "tenant.entitlement.override.update"
  | "commercial.accounts.update"
  | "commercial.contacts.update"
  | "commercial.contracts.update"
  | "commercial.invoices.update"
  | "commercial.invoiceDocuments.upload";

// ── Effective Role Derivation ─────────────────────────────────────────────────

/**
 * Derives the effective platform role code from a minimal user object.
 *
 * Rules:
 *   - user.role !== "super_admin"   → null (workspace / regular user)
 *   - isRootOwner === true           → "root_platform_owner"
 *   - platformRoleCode IS NULL       → "root_platform_owner" (legacy root)
 *   - platformRoleCode set           → that code (if known), else null
 */
export function getEffectivePlatformRoleCode(
  user: MinimalPlatformUser,
): PlatformRoleCode | null {
  if (user.role !== "super_admin") return null;
  if (user.isRootOwner) return "root_platform_owner";
  if (!user.platformRoleCode) return "root_platform_owner"; // legacy root
  const code = user.platformRoleCode as PlatformRoleCode;
  if (!PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG[code]) return null; // unknown role
  return code;
}

// ── Permission Derivation ─────────────────────────────────────────────────────

export function getCurrentPlatformPermissions(
  user: MinimalPlatformUser,
): Set<PlatformPermissionCode> {
  const roleCode = getEffectivePlatformRoleCode(user);
  if (!roleCode) return new Set();
  return new Set(PLATFORM_ROLE_PERMISSION_MATRIX_CONFIG[roleCode]);
}

export function hasPlatformPermissionClient(
  user: MinimalPlatformUser,
  permission: PlatformPermissionCode,
): boolean {
  return getCurrentPlatformPermissions(user).has(permission);
}

export function hasAnyPlatformPermissionClient(
  user: MinimalPlatformUser,
  permissions: readonly PlatformPermissionCode[],
): boolean {
  const set = getCurrentPlatformPermissions(user);
  return permissions.some((p) => set.has(p));
}

export function hasAllPlatformPermissionsClient(
  user: MinimalPlatformUser,
  permissions: readonly PlatformPermissionCode[],
): boolean {
  const set = getCurrentPlatformPermissions(user);
  return permissions.every((p) => set.has(p));
}

// ── Route Access ──────────────────────────────────────────────────────────────

const ROUTE_PERMISSION_MAP: Record<PlatformRouteKey, readonly PlatformPermissionCode[]> = {
  "platform.users":               ["platform.users.read"],
  "tenant.registry":              ["tenants.read"],
  "tenant.console.overview":      ["tenants.read", "health.read", "usage.read", "renewal.read"],
  "tenant.console.lifecycle":     ["tenants.read", "tenants.lifecycle.update"],
  "tenant.console.subscription":  ["subscriptions.read"],
  "tenant.console.entitlements":  ["entitlements.read"],
  "tenant.console.usage":         ["usage.read"],
  "tenant.console.renewal":       ["renewal.read"],
  "tenant.console.health":        ["health.read"],
  "tenant.console.evaluation":    ["evaluation.read"],
  "platform.activity":            ["platform.activity.read"],
  "audit":                        ["audit.read"],
};

/**
 * Returns true if the user has ANY of the permissions required for the route.
 */
export function canAccessPlatformRoute(
  user: MinimalPlatformUser,
  routeKey: PlatformRouteKey,
): boolean {
  const required = ROUTE_PERMISSION_MAP[routeKey];
  if (!required || required.length === 0) return true;
  return hasAnyPlatformPermissionClient(user, required);
}

// ── Navigation Filtering ──────────────────────────────────────────────────────

/**
 * null = no permission required (always visible to all platform users)
 */
const NAV_PERMISSION_MAP: Record<PlatformNavItemKey, readonly PlatformPermissionCode[] | null> = {
  "overview":          null,
  "workspaces":        null, // out-of-scope in P14-C - always visible
  "tenant-registry":   ["tenants.read"],
  "commercial-risk":   ["commercial.risk.read"],
  "platform-users":    ["platform.users.read"],
  "access-review":     ["platform.accessReview.read"],
  "platform-activity": ["platform.activity.read"],
  "event-log":         ["audit.read"],
  "platform-settings": ["platform.settings.read"],
  "platform-ops":      ["platform.governance.ops.read"],
};

export function canViewPlatformNavItem(
  user: MinimalPlatformUser,
  navItemKey: PlatformNavItemKey,
): boolean {
  const required = NAV_PERMISSION_MAP[navItemKey];
  if (required === null) return true;
  return hasAnyPlatformPermissionClient(user, required);
}

// ── Tenant Console Tab Visibility ─────────────────────────────────────────────

const CONSOLE_TAB_PERMISSION_MAP: Record<ConsoleTab, readonly PlatformPermissionCode[]> = {
  overview:     ["tenants.read", "health.read", "usage.read", "renewal.read"],
  lifecycle:    ["tenants.read", "tenants.lifecycle.update"],
  subscription: [
    "subscriptions.read",
    "platform.subscriptions.read",
    "platform.entitlements.read",
    "platform.quotas.read",
    "platform.subscriptionPolicies.read",
    "platform.workspaceAccess.read",
  ],
  subscription_entitlements: [
    "platform.subscriptions.read",
    "platform.entitlements.read",
    "platform.quotas.read",
    "platform.subscriptionPolicies.read",
    "platform.workspaceAccess.read",
  ],
  entitlements: ["entitlements.read"],
  usage:        ["usage.read"],
  renewal:      ["renewal.read"],
  health:       ["health.read"],
  evaluation:   ["evaluation.read"],
  commercial:   ["commercial.accounts.read"],
};

export function canViewTenantConsoleTab(
  user: MinimalPlatformUser,
  tabKey: ConsoleTab,
): boolean {
  const required = CONSOLE_TAB_PERMISSION_MAP[tabKey];
  if (!required || required.length === 0) return true;
  return hasAnyPlatformPermissionClient(user, required);
}

// ── Action Visibility ─────────────────────────────────────────────────────────

const ACTION_PERMISSION_MAP: Record<PlatformActionKey, PlatformPermissionCode> = {
  "platform.user.create":               "platform.users.create",
  "platform.user.update":               "platform.users.update",
  "platform.user.disable":              "platform.users.disable",
  "platform.user.reactivate":           "platform.users.reactivate",
  "platform.user.status.update":        "platform.users.status.update",
  "platform.user.role.update":          "platform.users.role.update",
  "tenant.lifecycle.update":            "tenants.lifecycle.update",
  "tenant.subscription.update":                 "subscriptions.update",
  "tenant.workspace_subscription.update":       "platform.subscriptions.update",
  "tenant.workspace_subscription.status.change": "platform.subscriptions.status.change",
  "tenant.workspace_entitlements.update":       "platform.entitlements.update",
  "tenant.workspace_quotas.update":             "platform.quotas.update",
  "tenant.workspace_subscription_policies.update": "platform.subscriptionPolicies.update",
  "tenant.workspace_access.update":             "platform.workspaceAccess.update",
  "tenant.entitlement.override.update":         "entitlements.override.update",
  "commercial.accounts.update":         "commercial.accounts.update",
  "commercial.contacts.update":         "commercial.contacts.update",
  "commercial.contracts.update":        "commercial.contracts.update",
  "commercial.invoices.update":         "commercial.invoices.update",
  "commercial.invoiceDocuments.upload": "commercial.invoiceDocuments.upload",
};

export function canPerformPlatformAction(
  user: MinimalPlatformUser,
  actionKey: PlatformActionKey,
): boolean {
  const required = ACTION_PERMISSION_MAP[actionKey];
  return hasPlatformPermissionClient(user, required);
}

// ── Convenience re-exports ────────────────────────────────────────────────────
export type { PlatformPermissionCode, PlatformRoleCode, ConsoleTab };
