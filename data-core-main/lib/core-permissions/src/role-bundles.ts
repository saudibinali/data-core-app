/**
 * Default permission bundles for built-in workspace roles (F2.5).
 * Used when WORKSPACE_RBAC_STRICT=true instead of implicit admin bypass.
 */

export const ADMIN_ROLE_PERMISSIONS: readonly string[] = [
  "users.view",
  "users.create",
  "users.edit",
  "users.delete",
  "users.reset_password",
  "departments.view",
  "departments.create",
  "departments.edit",
  "departments.delete",
  "tickets.view",
  "tickets.create",
  "tickets.edit",
  "tickets.assign",
  "tickets.close",
  "approvals.view",
  "approvals.manage",
  "hr.view",
  "hr.manage",
  "hr.services.manage",
  "hr.payroll.view",
  "hr.payroll.admin",
  "hr.payroll.export",
  "hr.attendance.view",
  "hr.attendance.manage",
  "hr.attendance.import",
  "leave.view",
  "leave.manage",
  "leave.submit",
];

export const MANAGER_ROLE_PERMISSIONS: readonly string[] = [
  "users.view",
  "departments.view",
  "tickets.view",
  "tickets.create",
  "tickets.edit",
  "tickets.assign",
  "tickets.close",
  "approvals.view",
  "approvals.manage",
  "hr.view",
  "hr.manage",
  "leave.view",
  "leave.manage",
  "leave.submit",
];

export function builtInRoleGrantsPermission(role: string, permission: string): boolean {
  if (role === "admin") return ADMIN_ROLE_PERMISSIONS.includes(permission);
  if (role === "manager") return MANAGER_ROLE_PERMISSIONS.includes(permission);
  return false;
}
