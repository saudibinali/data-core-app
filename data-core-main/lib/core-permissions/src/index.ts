/**
 * @workspace/core-permissions
 *
 * Public surface of the core-permissions package.
 * Export only the types that cross package boundaries.
 * Do NOT export runtime implementations from here.
 */

export type {
  BuiltInRole,
  PermissionKey,
  WorkspaceRoleRef,
  PermissionActor,
  PermissionCheckRequest,
  PermissionCheckResult,
} from "./types";
