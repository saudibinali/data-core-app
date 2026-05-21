import { type Response, type NextFunction } from "express";
import { type AuthRequest } from "./requireAuth";

export const PAYROLL_PERMISSIONS = [
  "hr.payroll.view",
  "hr.payroll.calculate",
  "hr.payroll.approve",
  "hr.payroll.export",
  "hr.payroll.admin",
] as const;

export type PayrollPermission = (typeof PAYROLL_PERMISSIONS)[number];

/** hr.manage and admin roles satisfy all payroll permissions */
export function requirePayrollPermission(permission: PayrollPermission) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const role = req.userRole;
    if (!role) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (["super_admin", "admin", "manager"].includes(role)) {
      next();
      return;
    }
    const perms = req.userPermissions ?? [];
    if (
      perms.includes(permission) ||
      perms.includes("hr.payroll.admin") ||
      perms.includes("hr.manage")
    ) {
      next();
      return;
    }
    res.status(403).json({ error: "Permission denied", required: permission });
  };
}

export function maskPayrollListRow<T extends { baseAmount?: string; grossAmount?: string; netAmount?: string }>(
  row: T,
  canViewAmounts: boolean,
): T {
  if (canViewAmounts) return row;
  return {
    ...row,
    baseAmount: row.baseAmount != null ? "****" : undefined,
    grossAmount: row.grossAmount != null ? "****" : undefined,
    netAmount: row.netAmount != null ? "****" : undefined,
  };
}

export function canViewSalaryAmounts(req: AuthRequest): boolean {
  if (!req.userRole) return false;
  if (["super_admin", "admin", "manager"].includes(req.userRole)) return true;
  const perms = req.userPermissions ?? [];
  return perms.some((p) =>
    ["hr.payroll.view", "hr.payroll.calculate", "hr.payroll.approve", "hr.payroll.admin", "hr.manage"].includes(p),
  );
}
