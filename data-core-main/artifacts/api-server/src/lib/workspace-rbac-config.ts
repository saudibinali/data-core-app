/**
 * F2.5 — Workspace RBAC strict mode configuration.
 */

export function isWorkspaceRbacStrict(): boolean {
  return process.env.WORKSPACE_RBAC_STRICT === "true";
}

/** F2.2 — When true, PostgreSQL RLS policies enforce workspace_id (pilot). */
export function isWorkspaceRlsEnforced(): boolean {
  return process.env.WORKSPACE_RLS_ENFORCE === "true";
}
