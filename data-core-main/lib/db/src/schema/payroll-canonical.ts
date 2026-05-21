/**
 * P21-B — Canonical payroll platform (decimal money, workspace-scoped)
 */
import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  date,
  numeric,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./users";
import { employeesTable } from "./hr";
import { hrPayrollRunsTable } from "./hr";

const money = (name: string) => numeric(name, { precision: 19, scale: 4 });

export const payrollCyclesTable = pgTable(
  "payroll_cycles",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    frequency: text("frequency").notNull().default("monthly"),
    anchorDay: integer("anchor_day").notNull().default(1),
    timezone: text("timezone").notNull().default("UTC"),
    isActive: boolean("is_active").notNull().default(true),
    createdByUserId: integer("created_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("uq_payroll_cycles_ws_code").on(t.workspaceId, t.code),
    index("idx_payroll_cycles_workspace").on(t.workspaceId),
  ],
);

export const payrollPeriodsTable = pgTable(
  "payroll_periods",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    cycleId: integer("cycle_id")
      .notNull()
      .references(() => payrollCyclesTable.id, { onDelete: "restrict" }),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    periodLabel: text("period_label").notNull(),
    status: text("status").notNull().default("open"),
    cutoffAt: timestamp("cutoff_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedByUserId: integer("closed_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("uq_payroll_periods_ws_label").on(t.workspaceId, t.periodLabel),
    index("idx_payroll_periods_workspace").on(t.workspaceId),
    index("idx_payroll_periods_dates").on(t.periodStart, t.periodEnd),
  ],
);

export const payrollRunsTable = pgTable(
  "payroll_runs",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    periodId: integer("period_id")
      .notNull()
      .references(() => payrollPeriodsTable.id, { onDelete: "restrict" }),
    runNumber: integer("run_number").notNull().default(1),
    runType: text("run_type").notNull().default("preview"),
    status: text("status").notNull().default("draft"),
    idempotencyKey: text("idempotency_key").notNull(),
    calculationVersion: integer("calculation_version").notNull().default(1),
    currencyCode: text("currency_code").notNull().default("SAR"),
    totalGross: money("total_gross").notNull().default("0"),
    totalNet: money("total_net").notNull().default("0"),
    totalDeductions: money("total_deductions").notNull().default("0"),
    employeeCount: integer("employee_count").notNull().default(0),
    legacyPayrollRunId: integer("legacy_payroll_run_id").references(() => hrPayrollRunsTable.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedByUserId: integer("approved_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    correctsRunId: integer("corrects_run_id").references((): AnyPgColumn => payrollRunsTable.id, {
      onDelete: "set null",
    }),
    reviewWarningsJson: text("review_warnings_json"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    submittedForReviewAt: timestamp("submitted_for_review_at", { withTimezone: true }),
    submittedForReviewByUserId: integer("submitted_for_review_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    createdByUserId: integer("created_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("uq_payroll_runs_idempotency").on(t.workspaceId, t.idempotencyKey),
    index("idx_payroll_runs_corrects").on(t.correctsRunId),
    index("idx_payroll_runs_workspace").on(t.workspaceId),
    index("idx_payroll_runs_period").on(t.periodId),
    index("idx_payroll_runs_status").on(t.status),
  ],
);

export const payrollComponentsTable = pgTable(
  "payroll_components",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    componentClass: text("component_class").notNull().default("earning"),
    subType: text("sub_type").notNull().default("allowance"),
    calculationMethod: text("calculation_method").notNull().default("fixed"),
    glAccountCode: text("gl_account_code"),
    debitAccountCode: text("debit_account_code"),
    creditAccountCode: text("credit_account_code"),
    costCenterCode: text("cost_center_code"),
    exportCode: text("export_code"),
    isTaxable: boolean("is_taxable").notNull().default(false),
    displayOrder: integer("display_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    legacySalaryComponentId: integer("legacy_salary_component_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("uq_payroll_components_ws_code").on(t.workspaceId, t.code),
    index("idx_payroll_components_workspace").on(t.workspaceId),
  ],
);

export const compensationPackagesTable = pgTable(
  "compensation_packages",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),
    structureCode: text("structure_code"),
    baseAmount: money("base_amount").notNull().default("0"),
    currencyCode: text("currency_code").notNull().default("SAR"),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    status: text("status").notNull().default("active"),
    packageJson: text("package_json").notNull().default("{}"),
    legacyCompensationId: integer("legacy_compensation_id"),
    supersededById: integer("superseded_by_id"),
    approvedByUserId: integer("approved_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdByUserId: integer("created_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_compensation_packages_employee").on(t.employeeId),
    index("idx_compensation_packages_workspace").on(t.workspaceId),
    index("idx_compensation_packages_status").on(t.status),
  ],
);

export const compensationAdjustmentsTable = pgTable(
  "compensation_adjustments",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),
    periodId: integer("period_id").references(() => payrollPeriodsTable.id, { onDelete: "set null" }),
    adjustmentType: text("adjustment_type").notNull(),
    amount: money("amount").notNull().default("0"),
    currencyCode: text("currency_code").notNull().default("SAR"),
    effectiveDate: date("effective_date").notNull(),
    reason: text("reason"),
    status: text("status").notNull().default("approved"),
    approvedByUserId: integer("approved_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdByUserId: integer("created_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_compensation_adjustments_employee").on(t.employeeId),
    index("idx_compensation_adjustments_period").on(t.periodId),
  ],
);

export const payrollRunEmployeesTable = pgTable(
  "payroll_run_employees",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    runId: integer("run_id")
      .notNull()
      .references(() => payrollRunsTable.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),
    compensationPackageId: integer("compensation_package_id").references(
      () => compensationPackagesTable.id,
      { onDelete: "set null" },
    ),
    status: text("status").notNull().default("included"),
    scheduledDays: integer("scheduled_days").notNull().default(0),
    paidDays: integer("paid_days").notNull().default(0),
    unpaidAbsenceDays: integer("unpaid_absence_days").notNull().default(0),
    grossAmount: money("gross_amount").notNull().default("0"),
    netAmount: money("net_amount").notNull().default("0"),
    inputSnapshotJson: text("input_snapshot_json"),
    errorMessage: text("error_message"),
    warningsJson: text("warnings_json"),
    reviewStatus: text("review_status").notNull().default("ok"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("uq_payroll_run_employees").on(t.runId, t.employeeId),
    index("idx_payroll_run_employees_run").on(t.runId),
  ],
);

export const payrollComponentValuesTable = pgTable(
  "payroll_component_values",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    runEmployeeId: integer("run_employee_id")
      .notNull()
      .references(() => payrollRunEmployeesTable.id, { onDelete: "cascade" }),
    componentId: integer("component_id").references(() => payrollComponentsTable.id, {
      onDelete: "set null",
    }),
    source: text("source").notNull().default("compensation"),
    quantity: money("quantity").notNull().default("1"),
    rate: money("rate").notNull().default("0"),
    amount: money("amount").notNull().default("0"),
    currencyCode: text("currency_code").notNull().default("SAR"),
    referenceType: text("reference_type"),
    referenceId: integer("reference_id"),
    metadataJson: text("metadata_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_payroll_component_values_run_emp").on(t.runEmployeeId),
    index("idx_payroll_component_values_component").on(t.componentId),
  ],
);

export const payrollPoliciesTable = pgTable(
  "payroll_policies",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    policyKey: text("policy_key").notNull(),
    policyJson: text("policy_json").notNull().default("{}"),
    version: integer("version").notNull().default(1),
    effectiveFrom: date("effective_from").notNull(),
    createdByUserId: integer("created_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_payroll_policies_ws_key_ver").on(t.workspaceId, t.policyKey, t.version),
    index("idx_payroll_policies_workspace").on(t.workspaceId),
  ],
);

export const payrollPayslipsTable = pgTable(
  "payroll_payslips",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    runId: integer("run_id")
      .notNull()
      .references(() => payrollRunsTable.id, { onDelete: "cascade" }),
    runEmployeeId: integer("run_employee_id")
      .notNull()
      .references(() => payrollRunEmployeesTable.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),
    payslipNumber: text("payslip_number"),
    status: text("status").notNull().default("draft"),
    correctsPayslipId: integer("corrects_payslip_id").references((): AnyPgColumn => payrollPayslipsTable.id, {
      onDelete: "set null",
    }),
    grossAmount: money("gross_amount").notNull().default("0"),
    netAmount: money("net_amount").notNull().default("0"),
    totalDeductions: money("total_deductions").notNull().default("0"),
    currencyCode: text("currency_code").notNull().default("SAR"),
    snapshotJson: text("snapshot_json"),
    ytdJson: text("ytd_json"),
    pdfStorageKey: text("pdf_storage_key"),
    documentId: integer("document_id"),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    issuedByUserId: integer("issued_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("uq_payroll_payslips_run_employee").on(t.runId, t.employeeId),
    uniqueIndex("uq_payroll_payslips_ws_number").on(t.workspaceId, t.payslipNumber),
    index("idx_payroll_payslips_workspace").on(t.workspaceId),
    index("idx_payroll_payslips_employee").on(t.employeeId),
  ],
);

export const payrollAuditLogsTable = pgTable(
  "payroll_audit_logs",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: integer("resource_id"),
    metadataJson: text("metadata_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_payroll_audit_logs_workspace").on(t.workspaceId),
    index("idx_payroll_audit_logs_action").on(t.action),
    index("idx_payroll_audit_logs_created").on(t.createdAt),
  ],
);

export const payrollExceptionsTable = pgTable(
  "payroll_exceptions",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    runId: integer("run_id").references(() => payrollRunsTable.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id").references(() => employeesTable.id, { onDelete: "set null" }),
    exceptionCode: text("exception_code").notNull(),
    severity: text("severity").notNull().default("warning"),
    message: text("message").notNull(),
    status: text("status").notNull().default("open"),
    metadataJson: text("metadata_json"),
    acknowledgedByUserId: integer("acknowledged_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_payroll_exceptions_workspace").on(t.workspaceId),
    index("idx_payroll_exceptions_run").on(t.runId),
    index("idx_payroll_exceptions_status").on(t.status),
  ],
);

export const payrollLocksTable = pgTable(
  "payroll_locks",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    periodId: integer("period_id")
      .notNull()
      .references(() => payrollPeriodsTable.id, { onDelete: "cascade" }),
    lockType: text("lock_type").notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }).notNull().defaultNow(),
    lockedByUserId: integer("locked_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    runId: integer("run_id").references(() => payrollRunsTable.id, { onDelete: "set null" }),
    breakGlassReason: text("break_glass_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_payroll_locks_period_type").on(t.periodId, t.lockType),
    index("idx_payroll_locks_workspace").on(t.workspaceId),
  ],
);

export type PayrollCycle = typeof payrollCyclesTable.$inferSelect;
export type PayrollPeriod = typeof payrollPeriodsTable.$inferSelect;
export type PayrollRun = typeof payrollRunsTable.$inferSelect;
export type PayrollComponent = typeof payrollComponentsTable.$inferSelect;
export type CompensationPackage = typeof compensationPackagesTable.$inferSelect;
export type PayrollRunEmployee = typeof payrollRunEmployeesTable.$inferSelect;
export type PayrollPayslip = typeof payrollPayslipsTable.$inferSelect;
export type PayrollAuditLog = typeof payrollAuditLogsTable.$inferSelect;
export type PayrollException = typeof payrollExceptionsTable.$inferSelect;
