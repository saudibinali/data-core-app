/**
 * P19-F — Report Center permissions & labels
 */

export const REPORT_CENTER_PERMISSIONS = {
  MANAGE: "hr.manage",
  VIEW: "reports.view",
} as const;

export function canViewReportCenter(hasPermission: (key: string) => boolean): boolean {
  return (
    hasPermission("admin") ||
    hasPermission(REPORT_CENTER_PERMISSIONS.MANAGE) ||
    hasPermission(REPORT_CENTER_PERMISSIONS.VIEW)
  );
}

export function canManageReportCenter(hasPermission: (key: string) => boolean): boolean {
  return hasPermission("admin") || hasPermission(REPORT_CENTER_PERMISSIONS.MANAGE);
}

export const REPORT_STATUS_LABELS: Record<string, { en: string; ar: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { en: "Pending", ar: "قيد الانتظار", variant: "secondary" },
  processing: { en: "Processing", ar: "قيد المعالجة", variant: "default" },
  completed: { en: "Completed", ar: "مكتمل", variant: "default" },
  failed: { en: "Failed", ar: "فشل", variant: "destructive" },
};

export const FORMAT_LABELS: Record<string, string> = {
  pdf: "PDF",
  xlsx: "Excel",
  csv: "CSV",
};

export const REPORT_DEFINITION_LABELS: Record<string, { en: string; ar: string }> = {
  "hr.employees.roster": { en: "Employee Roster", ar: "سجل الموظفين" },
  "hr.attendance.period": { en: "Attendance Period", ar: "حضور الفترة" },
  "hr.leave.balances": { en: "Leave Balances", ar: "أرصدة الإجازات" },
};
