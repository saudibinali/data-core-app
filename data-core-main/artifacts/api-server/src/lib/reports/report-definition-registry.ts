/** P19-D/E — Canonical report definitions */

export type ReportFormat = "xlsx" | "csv" | "pdf" | "json";

export type ReportDefinition = {
  key: string;
  title: string;
  module: string;
  supportedFormats: ReportFormat[];
  permission: string;
  asyncThresholdRows: number;
  defaultExpiryDays: number;
};

export const REPORT_DEFINITIONS: ReportDefinition[] = [
  {
    key: "hr.employees.roster",
    title: "Employee Roster",
    module: "hr",
    supportedFormats: ["xlsx", "csv", "pdf"],
    permission: "hr.manage",
    asyncThresholdRows: Number(process.env.REPORT_ASYNC_ROW_THRESHOLD ?? 1000),
    defaultExpiryDays: 30,
  },
  {
    key: "hr.attendance.import.reconciliation",
    title: "Attendance Import Reconciliation",
    module: "hr",
    supportedFormats: ["json"],
    permission: "hr.manage",
    asyncThresholdRows: 0,
    defaultExpiryDays: 90,
  },
  {
    key: "hr.attendance.period",
    title: "Attendance Period Export",
    module: "hr",
    supportedFormats: ["xlsx", "csv", "pdf"],
    permission: "hr.manage",
    asyncThresholdRows: Number(process.env.REPORT_ASYNC_ROW_THRESHOLD ?? 500),
    defaultExpiryDays: 14,
  },
  {
    key: "hr.leave.balances",
    title: "Leave Balances",
    module: "hr",
    supportedFormats: ["xlsx", "csv", "pdf"],
    permission: "hr.manage",
    asyncThresholdRows: Number(process.env.REPORT_ASYNC_ROW_THRESHOLD ?? 500),
    defaultExpiryDays: 30,
  },
  {
    key: "hr.leave.requests",
    title: "Leave Requests Register",
    module: "hr",
    supportedFormats: ["xlsx", "csv", "pdf"],
    permission: "hr.manage",
    asyncThresholdRows: Number(process.env.REPORT_ASYNC_ROW_THRESHOLD ?? 500),
    defaultExpiryDays: 30,
  },
  {
    key: "hr.workforce.integration.activity",
    title: "Workforce Integration Activity",
    module: "hr",
    supportedFormats: ["json"],
    permission: "hr.manage",
    asyncThresholdRows: 0,
    defaultExpiryDays: 30,
  },
  {
    key: "hr.workforce.sync.failures",
    title: "Workforce Sync Failures",
    module: "hr",
    supportedFormats: ["json"],
    permission: "hr.manage",
    asyncThresholdRows: 0,
    defaultExpiryDays: 30,
  },
  {
    key: "hr.workforce.unresolved.mappings",
    title: "Unresolved Employee Mappings",
    module: "hr",
    supportedFormats: ["json"],
    permission: "hr.manage",
    asyncThresholdRows: 0,
    defaultExpiryDays: 30,
  },
  {
    key: "hr.workforce.attendance.warnings",
    title: "Attendance Warning Trends",
    module: "hr",
    supportedFormats: ["json"],
    permission: "hr.manage",
    asyncThresholdRows: 0,
    defaultExpiryDays: 30,
  },
  {
    key: "hr.payroll.register",
    title: "Payroll Register (Foundation)",
    module: "hr",
    supportedFormats: ["json"],
    permission: "hr.payroll.export",
    asyncThresholdRows: 0,
    defaultExpiryDays: 90,
  },
  {
    key: "hr.payroll.components",
    title: "Payroll Components (Foundation)",
    module: "hr",
    supportedFormats: ["json"],
    permission: "hr.payroll.export",
    asyncThresholdRows: 0,
    defaultExpiryDays: 90,
  },
  {
    key: "hr.payroll.payslip.pdf",
    title: "Payslip PDF",
    module: "hr",
    supportedFormats: ["pdf"],
    permission: "hr.payroll.export",
    asyncThresholdRows: 0,
    defaultExpiryDays: 90,
  },
  {
    key: "hr.payroll.payslips.batch",
    title: "Payslip Batch Metadata",
    module: "hr",
    supportedFormats: ["json"],
    permission: "hr.payroll.export",
    asyncThresholdRows: 0,
    defaultExpiryDays: 90,
  },
  {
    key: "hr.payroll.variance",
    title: "Payroll Variance (Corrections)",
    module: "hr",
    supportedFormats: ["json"],
    permission: "hr.payroll.export",
    asyncThresholdRows: 0,
    defaultExpiryDays: 90,
  },
  {
    key: "hr.payroll.correction.activity",
    title: "Payroll Correction Activity",
    module: "hr",
    supportedFormats: ["json"],
    permission: "hr.payroll.export",
    asyncThresholdRows: 0,
    defaultExpiryDays: 90,
  },
  {
    key: "hr.payroll.warnings",
    title: "Payroll Review Warnings",
    module: "hr",
    supportedFormats: ["json"],
    permission: "hr.payroll.export",
    asyncThresholdRows: 0,
    defaultExpiryDays: 90,
  },
  {
    key: "hr.payroll.component.summary",
    title: "Payroll Component Summary",
    module: "hr",
    supportedFormats: ["json"],
    permission: "hr.payroll.export",
    asyncThresholdRows: 0,
    defaultExpiryDays: 90,
  },
  {
    key: "hr.payroll.locked.period.audit",
    title: "Locked Period Audit",
    module: "hr",
    supportedFormats: ["json"],
    permission: "hr.payroll.export",
    asyncThresholdRows: 0,
    defaultExpiryDays: 90,
  },
  {
    key: "hr.payroll.exceptions",
    title: "Payroll Exceptions",
    module: "hr",
    supportedFormats: ["json"],
    permission: "hr.payroll.export",
    asyncThresholdRows: 0,
    defaultExpiryDays: 90,
  },
  {
    key: "platform.workspace.lifecycle",
    title: "Platform — Workspace Lifecycle Events",
    module: "platform",
    supportedFormats: ["json"],
    permission: "platform.governance.ops.read",
    asyncThresholdRows: 0,
    defaultExpiryDays: 90,
  },
  {
    key: "platform.module.governance",
    title: "Platform — Module Governance Audit",
    module: "platform",
    supportedFormats: ["json"],
    permission: "platform.governance.ops.read",
    asyncThresholdRows: 0,
    defaultExpiryDays: 90,
  },
  {
    key: "platform.support.audit",
    title: "Platform — Support Session Audit",
    module: "platform",
    supportedFormats: ["json"],
    permission: "platform.governance.ops.read",
    asyncThresholdRows: 0,
    defaultExpiryDays: 90,
  },
  {
    key: "platform.impersonation.audit",
    title: "Platform — Impersonation Sessions",
    module: "platform",
    supportedFormats: ["json"],
    permission: "platform.governance.ops.read",
    asyncThresholdRows: 0,
    defaultExpiryDays: 90,
  },
  {
    key: "platform.governance.actions",
    title: "Platform — Governance Actions",
    module: "platform",
    supportedFormats: ["json"],
    permission: "platform.governance.ops.read",
    asyncThresholdRows: 0,
    defaultExpiryDays: 90,
  },
];

export class ReportDefinitionRegistry {
  get(key: string): ReportDefinition | undefined {
    return REPORT_DEFINITIONS.find((d) => d.key === key);
  }

  list(): ReportDefinition[] {
    return [...REPORT_DEFINITIONS];
  }

  assertFormat(def: ReportDefinition, format: string): ReportFormat {
    if (!def.supportedFormats.includes(format as ReportFormat)) {
      throw new Error(`Format ${format} not supported for ${def.key}`);
    }
    return format as ReportFormat;
  }
}

export const reportDefinitionRegistry = new ReportDefinitionRegistry();
