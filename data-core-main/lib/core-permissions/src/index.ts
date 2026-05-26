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

export { evaluatePolicy, type EvaluatePolicyOptions } from "./evaluate-policy";
export {
  ADMIN_ROLE_PERMISSIONS,
  MANAGER_ROLE_PERMISSIONS,
  builtInRoleGrantsPermission,
} from "./role-bundles";
