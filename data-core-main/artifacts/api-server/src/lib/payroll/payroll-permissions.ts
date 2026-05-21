/**
 * P21-B — Canonical payroll permission keys (assign via workspace custom roles).
 * Admin/manager/hr.manage bypass is handled in requirePayrollPermission middleware.
 */
export const PAYROLL_PERMISSION_KEYS = [
  "hr.payroll.view",
  "hr.payroll.calculate",
  "hr.payroll.approve",
  "hr.payroll.export",
  "hr.payroll.admin",
] as const;

export type PayrollPermissionKey = (typeof PAYROLL_PERMISSION_KEYS)[number];

/** Suggested role bundles for workspace administrators */
export const PAYROLL_ROLE_BUNDLES: Record<string, PayrollPermissionKey[]> = {
  payroll_viewer: ["hr.payroll.view"],
  payroll_operator: ["hr.payroll.view", "hr.payroll.calculate", "hr.payroll.export"],
  payroll_approver: ["hr.payroll.view", "hr.payroll.approve", "hr.payroll.export"],
  payroll_admin: [...PAYROLL_PERMISSION_KEYS],
};
