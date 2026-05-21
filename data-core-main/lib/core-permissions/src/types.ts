/**
 * @package @workspace/core-permissions
 * @purpose  Canonical permission model for role-based and attribute-based access control.
 *
 * The platform has a four-level built-in role hierarchy (super_admin → admin → manager → member)
 * plus per-workspace custom roles. This package defines the shared vocabulary for
 * expressing, checking, and extending permissions.
 *
 * Ownership:  Platform Core — middlewares and UI guards consume this package.
 *             No module should define its own role or permission primitives.
 * Future:     Add attribute-based conditions (ABAC), resource-level scopes,
 *             and a permission DSL for the no-code workflow engine.
 */

// ── Built-in roles ────────────────────────────────────────────────────────────

/**
 * BuiltInRole — the immutable platform-level role hierarchy.
 * Custom roles defined per-workspace are represented by `WorkspaceRoleRef`.
 */
export type BuiltInRole =
  | "super_admin"
  | "admin"
  | "manager"
  | "member";

// ── Permission key ────────────────────────────────────────────────────────────

/**
 * PermissionKey — a dot-namespaced permission identifier.
 *
 * Convention: `<resource>.<action>` or `<module>.<resource>.<action>`.
 * Examples:
 *   "tickets.create"
 *   "tickets.delete.any"
 *   "hr.payroll.view"
 *   "workspace.settings.edit"
 *
 * Future: generate this union from a central capability registry.
 */
export type PermissionKey = string & { readonly __brand: "PermissionKey" };

// ── Custom role reference ─────────────────────────────────────────────────────

/**
 * WorkspaceRoleRef — points to a custom role defined in workspace_custom_roles.
 * Used wherever a custom role is an alternative to a BuiltInRole.
 */
export interface WorkspaceRoleRef {
  type: "custom";
  roleId: number;
  roleName: string;
}

// ── Actor ─────────────────────────────────────────────────────────────────────

/**
 * PermissionActor — the subject of a permission check.
 * Mirrors the fields attached by `requireAuth` middleware.
 */
export interface PermissionActor {
  userId: number;
  workspaceId: number | null;
  role: BuiltInRole;
  /** Additional custom role IDs the actor holds within the workspace. */
  customRoleIds?: number[];
}

// ── Permission check ──────────────────────────────────────────────────────────

/**
 * PermissionCheckRequest — everything needed to evaluate a permission.
 *
 * Future: add `resourceContext` for attribute-based conditions
 *         (e.g. "is this ticket assigned to the actor?").
 */
export interface PermissionCheckRequest {
  actor: PermissionActor;
  permission: PermissionKey;
  /** Optional entity the permission is evaluated against. */
  resource?: {
    type: string;
    id: number;
    ownerId?: number;
  };
}

/**
 * PermissionCheckResult — outcome of a permission evaluation.
 */
export interface PermissionCheckResult {
  granted: boolean;
  /** Human-readable reason, useful for audit logs and 403 error messages. */
  reason?: string;
}
