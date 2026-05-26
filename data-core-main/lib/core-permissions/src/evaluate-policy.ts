/**
 * F2.4 — Incremental permission policy evaluator.
 */

import type { PermissionCheckRequest, PermissionCheckResult } from "./types";
import { builtInRoleGrantsPermission } from "./role-bundles";

export interface EvaluatePolicyOptions {
  /** Custom role permission keys loaded for the actor (member role). */
  customPermissions?: string[];
  /** When true, admin/manager must match role bundles (F2.5). */
  strictWorkspaceRbac?: boolean;
}

export function evaluatePolicy(
  request: PermissionCheckRequest,
  options: EvaluatePolicyOptions = {},
): PermissionCheckResult {
  const { actor, permission } = request;
  const perm = String(permission);
  const custom = options.customPermissions ?? [];

  if (actor.role === "super_admin") {
    return { granted: true, reason: "platform_super_admin" };
  }

  if (!options.strictWorkspaceRbac) {
    if (actor.role === "admin" || actor.role === "manager") {
      return { granted: true, reason: "legacy_role_bypass" };
    }
  } else if (builtInRoleGrantsPermission(actor.role, perm)) {
    return { granted: true, reason: `role_bundle:${actor.role}` };
  }

  if (custom.includes(perm)) {
    return { granted: true, reason: "custom_role_grant" };
  }

  return {
    granted: false,
    reason: `missing_permission:${perm}`,
  };
}
