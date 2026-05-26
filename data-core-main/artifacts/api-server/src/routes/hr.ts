import { Router, type IRouter } from "express";
import * as XLSX from "xlsx";
import { db } from "@workspace/db";
import {
  employeesTable,
  hrServicesTable,
  hrServiceCategoriesTable,
  hrOrgUnitsTable,
  hrJobTitlesTable,
  hrJobGradesTable,
  hrCustomFieldDefsTable,
  hrCustomFieldValuesTable,
  hrEmployeeContractsTable,
  hrEmployeeDocumentsTable,
  hrEmployeeLeavesTable,
  hrEmployeePositionHistoryTable,
  hrEmployeeNotesTable,
  hrEmployeeActivityTable,
  hrPositionsTable,
  hrWorkLocationsTable,
  hrEmployeeStatusesTable,
  hrEmploymentTypesTable,
  hrContractTypesTable,
  hrDocumentTypesTable,
  hrLeavePoliciesTable,
  hrProbationPoliciesTable,
  hrSalaryComponentsTable,
  hrSalaryStructuresTable,
  hrSalaryStructureComponentsTable,
  hrSalaryBandsTable,
  hrEmployeeCompensationsTable,
  hrEmployeeCompensationItemsTable,
  hrPayrollRunsTable,
  hrPayslipsTable,
  hrPayslipLinesTable,
  hrShiftsTable,
  hrWorkCalendarsTable,
  hrCalendarHolidaysTable,
  hrAttendanceTable,
  hrLeaveBalancesTable,
  hrOvertimePoliciesTable,
  hrOvertimeRecordsTable,
  hrWorkspaceCountersTable,
  hrWorkspaceSettingsTable,
  usersTable,
  departmentsTable,
  formDefinitionsTable,
  formSubmissionsTable,
  platformEventRegistryTable,
  workflowDefinitionsTable,
} from "@workspace/db";
import { eq, and, desc, sql, asc, ilike, or, isNull } from "drizzle-orm";
import { generateEmployeeNumber, validateManualEmployeeNumber } from "../lib/employeeNumber";
import { alias } from "drizzle-orm/pg-core";
import {
  type AuthRequest,
  requireAuth,
  requireWorkspaceAdmin,
  requirePermission,
} from "../middlewares/requireAuth";
import { assertLegacyLeaveWriteAllowed } from "../lib/leave-cutover-freeze";
import {
  assertLegacyPayrollWriteAllowed,
  assertLegacyAttendanceWriteAllowed,
} from "../lib/platform/infrastructure-cutover";
import {
  bridgeHrEmployeeDocument,
  bridgeContractAttachments,
} from "../lib/documents/document-bridge";
import { reportService } from "../lib/reports/report-service";
import { parseListPagination } from "../lib/list-pagination";
import {
  buildOrgTree,
  wouldCreateOrgCycle,
  handleWorkforceRouteError,
  parseHrDocumentUpload,
  buildEmployeeFileStorageKey,
  saveEmployeeFile,
  objectPathFromStorageKey,
  syncLegacyUserFieldsFromEmployee,
  normalizeOrgUnitType,
  isValidOrgUnitType,
  validateOrgParentType,
  getOrgUnitAncestors,
  getOrgUnitDescendantIds,
  getEmployeesInOrgSubtree,
  getFullReportingChain,
  ManagerCycleError,
  validateEmployeeOrgLinking,
  loadWorkspaceOrgUnits,
  getOrgUnitById,
} from "../lib/workforce";
import { validateWorkforceGovernance } from "../lib/workforce/operations/governance-service";
import { onEmployeeDocumentUploaded } from "../lib/workforce/operations/document-hooks";
import { appendTimelineEvent } from "../lib/workforce/operations/timeline-service";
import { assertLegacyWriteAllowed } from "../lib/workforce/stabilization/cleanup-staging";
import { recordLegacyUsage } from "../lib/workforce/stabilization/usage-telemetry";
import { loadDynamicEmploymentTypes, loadDynamicEmployeeStatuses } from "../lib/hr-import/catalog/dynamic-enum-loader";
import { getImportRuntimeSettings } from "../lib/hr-import/runtime-settings";
import { recordImportTelemetry, countUnresolvedFromWarnings } from "../lib/hr-import/telemetry/import-telemetry";
import { runShadowValidationPipeline } from "../lib/hr-import/validation/shadow-validation-runner";
import { buildEnterpriseImportPreview } from "../lib/hr-import/activation/enterprise-preview-orchestrator";
import { applyEnterpriseConfirmResolution } from "../lib/hr-import/activation/enterprise-confirm-bridge";
import { applyImportPreviewIntelligence, applyDeferredManagerLinks } from "../lib/hr-import/intelligence/import-intelligence-engine";
import { getEnterpriseRuntimeStatus } from "../lib/hr-import/activation/enterprise-runtime-activation";
import { isSchemaMismatchError } from "../lib/commercial-route-utils";
import { logger } from "../lib/logger";
import { HrEmployeeCreateBody, formatZodError } from "../lib/security-validation";
import { maybeDeactivateLinkedUserOnTermination } from "../lib/hr/employee-offboarding";
import {
  assertFoundationReadinessForImport,
  buildMasterDataLookupMaps,
  detectMasterDataMismatches,
  getEmployeeImportGovernanceSettings,
  resolveMasterDataIds,
} from "../lib/hr-foundation/employee-import-governance";
import { insertStagingBatch } from "../lib/hr-foundation/employee-import-staging-service";

const router: IRouter = Router();

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseId(val: unknown): number | null {
  const n = parseInt(String(val), 10);
  return isNaN(n) ? null : n;
}

/** Converts a human-readable string into a unique snake_case system identifier.
 *  "Full Time" → "full_time"  |  "Annual Contract" → "annual_contract"
 */
function toCode(str: string): string {
  if (!str?.trim()) return '';
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')   // strip special chars (keep word chars, spaces, hyphens)
    .replace(/[\s\-]+/g, '_')   // spaces + hyphens → underscore
    .replace(/_+/g, '_')        // collapse consecutive underscores
    .replace(/^_|_$/g, '')      // strip leading/trailing underscores
    .slice(0, 60);
}

/** Finds a unique code within a workspace by appending _2, _3, ...
 *  Pass existing codes (pre-fetched) to avoid N+1 queries in tight loops.
 */
function uniquifyCode(base: string, takenCodes: Set<string>, excludeCode?: string): string {
  const b = base || 'item';
  let candidate = b;
  for (let n = 2; n <= 200; n++) {
    if (!takenCodes.has(candidate) || candidate === excludeCode) return candidate;
    candidate = `${b}_${n}`;
  }
  return `${b}_${Date.now()}`;
}

function toSlug(text: string): string {
  return text
    .toLowerCase().trim()
    .replace(/[\u0600-\u06FF]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .substring(0, 60) || "service";
}

// Activity logger helper
async function logActivity(
  workspaceId: number,
  employeeId: number,
  action: string,
  description: string,
  performedBy?: number | null,
  performedByName?: string | null,
  changes?: unknown,
) {
  await db.insert(hrEmployeeActivityTable).values({
    workspaceId,
    employeeId,
    action,
    description,
    changes: changes ?? null,
    performedBy: performedBy ?? null,
    performedByName: performedByName ?? null,
  }).catch(() => { /* non-blocking */ });
}

// ── GET /hr/settings ──────────────────────────────────────────────────────────

router.get("/hr/settings", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  const [row] = await db
    .select()
    .from(hrWorkspaceSettingsTable)
    .where(eq(hrWorkspaceSettingsTable.workspaceId, workspaceId));

  // Return defaults if no row yet
  res.json(row ?? {
    workspaceId,
    numberingMode: "auto",
    numberingStartFrom: null,
    leaveRuntimeMode: "transition",
    workforceCanonicalMode: "legacy",
    workforceSyncDirection: "none",
    orgRuntimeMode: "legacy",
    approvalRuntimeMode: "legacy",
    workforceGovernanceMode: "legacy",
    workforceActivationRequires: null,
    workforceCleanupStage: "none",
    legacyWritePolicy: null,
  });
});

// ── PATCH /hr/settings ────────────────────────────────────────────────────────

router.patch("/hr/settings", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  const { numberingMode, numberingStartFrom, leaveRuntimeMode, workforceCanonicalMode, workforceSyncDirection, orgRuntimeMode, approvalRuntimeMode, workforceGovernanceMode, workforceActivationRequires, workforceCleanupStage, legacyWritePolicy } = req.body as {
    numberingMode?: string;
    numberingStartFrom?: number | null;
    leaveRuntimeMode?: string;
    workforceCanonicalMode?: string;
    workforceSyncDirection?: string;
    orgRuntimeMode?: string;
    approvalRuntimeMode?: string;
    workforceGovernanceMode?: string;
    workforceActivationRequires?: Record<string, unknown> | null;
    workforceCleanupStage?: string;
    legacyWritePolicy?: Record<string, unknown> | null;
  };

  const validModes = ["auto", "manual", "hybrid"];
  if (numberingMode && !validModes.includes(numberingMode)) {
    res.status(400).json({ error: "numberingMode must be auto | manual | hybrid" }); return;
  }

  const validLeaveModes = ["legacy", "transition", "canonical"];
  if (leaveRuntimeMode !== undefined && !validLeaveModes.includes(leaveRuntimeMode)) {
    res.status(400).json({ error: "leaveRuntimeMode must be legacy | transition | canonical" }); return;
  }

  const validWorkforceModes = ["legacy", "shadow", "active"];
  if (workforceCanonicalMode !== undefined && !validWorkforceModes.includes(workforceCanonicalMode)) {
    res.status(400).json({ error: "workforceCanonicalMode must be legacy | shadow | active" }); return;
  }

  const validSyncDirections = ["none", "employee_to_user", "bidirectional"];
  if (workforceSyncDirection !== undefined && !validSyncDirections.includes(workforceSyncDirection)) {
    res.status(400).json({ error: "workforceSyncDirection must be none | employee_to_user | bidirectional" }); return;
  }

  const validOrgModes = ["legacy", "shadow", "active"];
  if (orgRuntimeMode !== undefined && !validOrgModes.includes(orgRuntimeMode)) {
    res.status(400).json({ error: "orgRuntimeMode must be legacy | shadow | active" }); return;
  }

  const validApprovalModes = ["legacy", "dual", "unified"];
  if (approvalRuntimeMode !== undefined && !validApprovalModes.includes(approvalRuntimeMode)) {
    res.status(400).json({ error: "approvalRuntimeMode must be legacy | dual | unified" }); return;
  }

  const validGovernanceModes = ["legacy", "shadow", "active"];
  if (workforceGovernanceMode !== undefined && !validGovernanceModes.includes(workforceGovernanceMode)) {
    res.status(400).json({ error: "workforceGovernanceMode must be legacy | shadow | active" }); return;
  }

  const validCleanupStages = ["none", "stage1", "stage2", "stage3", "stage4"];
  if (workforceCleanupStage !== undefined && !validCleanupStages.includes(workforceCleanupStage)) {
    res.status(400).json({ error: "workforceCleanupStage must be none | stage1 | stage2 | stage3 | stage4" }); return;
  }

  const updates: Record<string, unknown> = {};
  if (numberingMode !== undefined) updates.numberingMode = numberingMode;
  if (numberingStartFrom !== undefined) updates.numberingStartFrom = numberingStartFrom;
  if (leaveRuntimeMode !== undefined) updates.leaveRuntimeMode = leaveRuntimeMode;
  if (workforceCanonicalMode !== undefined) updates.workforceCanonicalMode = workforceCanonicalMode;
  if (workforceSyncDirection !== undefined) updates.workforceSyncDirection = workforceSyncDirection;
  if (orgRuntimeMode !== undefined) updates.orgRuntimeMode = orgRuntimeMode;
  if (approvalRuntimeMode !== undefined) updates.approvalRuntimeMode = approvalRuntimeMode;
  if (workforceGovernanceMode !== undefined) updates.workforceGovernanceMode = workforceGovernanceMode;
  if (workforceActivationRequires !== undefined) updates.workforceActivationRequires = workforceActivationRequires;
  if (workforceCleanupStage !== undefined) updates.workforceCleanupStage = workforceCleanupStage;
  if (legacyWritePolicy !== undefined) updates.legacyWritePolicy = legacyWritePolicy;

  const [row] = await db
    .insert(hrWorkspaceSettingsTable)
    .values({ workspaceId, ...updates })
    .onConflictDoUpdate({
      target: hrWorkspaceSettingsTable.workspaceId,
      set: { ...updates, updatedAt: new Date() },
    })
    .returning();

  // If admin sets a new start-from number, sync the counter ahead
  if (typeof numberingStartFrom === "number" && numberingStartFrom > 0) {
    await db.execute(
      sql`INSERT INTO hr_workspace_counters (workspace_id, counter_name, current_value)
          VALUES (${workspaceId}, 'employee_number', ${numberingStartFrom - 1})
          ON CONFLICT (workspace_id, counter_name)
          DO UPDATE SET current_value = GREATEST(hr_workspace_counters.current_value, ${numberingStartFrom - 1})`,
    );
  }

  res.json(row);
});

// ── HR Dashboard ───────────────────────────────────────────────────────────────

router.get("/hr/dashboard", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [
    totalEmployees,
    activeEmployees,
    newHires,
    activeServices,
    pendingSubmissions,
    byEmploymentType,
    recentEmployees,
    byOrgUnit,
  ] = await Promise.all([
    db.select({ cnt: sql<number>`count(*)::int` })
      .from(employeesTable)
      .where(eq(employeesTable.workspaceId, workspaceId)),

    db.select({ cnt: sql<number>`count(*)::int` })
      .from(employeesTable)
      .where(and(eq(employeesTable.workspaceId, workspaceId), eq(employeesTable.status, "active"))),

    db.select({ cnt: sql<number>`count(*)::int` })
      .from(employeesTable)
      .where(and(
        eq(employeesTable.workspaceId, workspaceId),
        sql`${employeesTable.hireDate} >= ${thirtyDaysAgo.toISOString().slice(0, 10)}`,
      )),

    db.select({ cnt: sql<number>`count(*)::int` })
      .from(hrServicesTable)
      .where(and(eq(hrServicesTable.workspaceId, workspaceId), eq(hrServicesTable.status, "active"))),

    db.select({ cnt: sql<number>`count(*)::int` })
      .from(formSubmissionsTable)
      .where(and(
        eq(formSubmissionsTable.workspaceId, workspaceId),
        eq(formSubmissionsTable.status, "pending_approval"),
      )),

    db.select({ type: employeesTable.employmentType, cnt: sql<number>`count(*)::int` })
      .from(employeesTable)
      .where(eq(employeesTable.workspaceId, workspaceId))
      .groupBy(employeesTable.employmentType),

    db.select({
        id: employeesTable.id,
        fullName: employeesTable.fullName,
        position: employeesTable.position,
        avatarUrl: employeesTable.avatarUrl,
        hireDate: employeesTable.hireDate,
        status: employeesTable.status,
      })
      .from(employeesTable)
      .where(eq(employeesTable.workspaceId, workspaceId))
      .orderBy(desc(employeesTable.createdAt))
      .limit(5),

    db.select({
        orgUnitName: hrOrgUnitsTable.name,
        cnt: sql<number>`count(${employeesTable.id})::int`,
      })
      .from(employeesTable)
      .leftJoin(hrOrgUnitsTable, eq(employeesTable.orgUnitId, hrOrgUnitsTable.id))
      .where(eq(employeesTable.workspaceId, workspaceId))
      .groupBy(hrOrgUnitsTable.name)
      .orderBy(desc(sql`count(${employeesTable.id})`))
      .limit(8),
  ]);

  res.json({
    totalEmployees: totalEmployees[0]?.cnt ?? 0,
    activeEmployees: activeEmployees[0]?.cnt ?? 0,
    newHiresThisMonth: newHires[0]?.cnt ?? 0,
    activeServices: activeServices[0]?.cnt ?? 0,
    pendingSubmissions: pendingSubmissions[0]?.cnt ?? 0,
    byDepartment: byOrgUnit.map(r => ({ departmentName: r.orgUnitName ?? "Unassigned", cnt: r.cnt })),
    byEmploymentType,
    recentEmployees,
  });
});

// ── GET /hr/employees ──────────────────────────────────────────────────────────

const managerAlias = alias(employeesTable, "mgr");

router.get("/hr/employees", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  const { search, orgUnitId, employmentType, status } = req.query as Record<string, string | undefined>;
  const { limit, offset } = parseListPagination(req.query as Record<string, unknown>);

  const conditions = [eq(employeesTable.workspaceId, workspaceId)];
  if (orgUnitId)      conditions.push(eq(employeesTable.orgUnitId, parseInt(orgUnitId)));
  if (employmentType) conditions.push(eq(employeesTable.employmentType, employmentType));
  if (status)         conditions.push(eq(employeesTable.status, status));
  if (search) {
    conditions.push(
      or(
        ilike(employeesTable.fullName, `%${search}%`),
        ilike(employeesTable.email, `%${search}%`),
        ilike(employeesTable.employeeNumber, `%${search}%`),
        ilike(employeesTable.position, `%${search}%`),
      )!
    );
  }

  const rows = await db
    .select({
      id:               employeesTable.id,
      fullName:         employeesTable.fullName,
      firstName:        employeesTable.firstName,
      lastName:         employeesTable.lastName,
      email:            employeesTable.email,
      phoneNumber:      employeesTable.phoneNumber,
      employeeNumber:   employeesTable.employeeNumber,
      position:         employeesTable.position,
      avatarUrl:        employeesTable.avatarUrl,
      status:           employeesTable.status,
      employmentType:   employeesTable.employmentType,
      hireDate:         employeesTable.hireDate,
      branch:           employeesTable.branch,
      company:          employeesTable.company,
      location:         employeesTable.location,
      orgUnitId:        employeesTable.orgUnitId,
      orgUnitName:      hrOrgUnitsTable.name,
      jobTitleId:       employeesTable.jobTitleId,
      jobTitleName:     hrJobTitlesTable.name,
      jobGradeId:       employeesTable.jobGradeId,
      jobGradeName:     hrJobGradesTable.name,
      directManagerId:  employeesTable.directManagerId,
      managerName:      managerAlias.fullName,
      createdAt:        employeesTable.createdAt,
    })
    .from(employeesTable)
    .leftJoin(hrOrgUnitsTable, eq(employeesTable.orgUnitId, hrOrgUnitsTable.id))
    .leftJoin(hrJobTitlesTable, eq(employeesTable.jobTitleId, hrJobTitlesTable.id))
    .leftJoin(hrJobGradesTable, eq(employeesTable.jobGradeId, hrJobGradesTable.id))
    .leftJoin(managerAlias, eq(employeesTable.directManagerId, managerAlias.id))
    .where(and(...conditions))
    .orderBy(asc(employeesTable.fullName))
    .limit(limit)
    .offset(offset);

  const [totalRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(employeesTable)
    .where(and(...conditions));

  res.json({ employees: rows, total: totalRow?.total ?? 0 });
});

// ── GET /hr/employees/import-template  (dynamic, metadata-driven) ─────────────

router.get("/hr/employees/import-template", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  // Fetch all reference data in parallel
  const [orgUnits, jobTitles, jobGrades, positions, workLocations, customFields, settings] = await Promise.all([
    db.select({ id: hrOrgUnitsTable.id, name: hrOrgUnitsTable.name }).from(hrOrgUnitsTable).where(eq(hrOrgUnitsTable.workspaceId, workspaceId)),
    db.select({ id: hrJobTitlesTable.id, name: hrJobTitlesTable.name }).from(hrJobTitlesTable).where(eq(hrJobTitlesTable.workspaceId, workspaceId)),
    db.select({ id: hrJobGradesTable.id, name: hrJobGradesTable.name, code: hrJobGradesTable.code }).from(hrJobGradesTable).where(eq(hrJobGradesTable.workspaceId, workspaceId)),
    db.select({ id: hrPositionsTable.id, title: hrPositionsTable.title }).from(hrPositionsTable).where(eq(hrPositionsTable.workspaceId, workspaceId)),
    db.select({ id: hrWorkLocationsTable.id, name: hrWorkLocationsTable.name }).from(hrWorkLocationsTable).where(eq(hrWorkLocationsTable.workspaceId, workspaceId)),
    db.select().from(hrCustomFieldDefsTable).where(and(eq(hrCustomFieldDefsTable.workspaceId, workspaceId), eq(hrCustomFieldDefsTable.isActive, true))).orderBy(asc(hrCustomFieldDefsTable.displayOrder)),
    db.select().from(hrWorkspaceSettingsTable).where(eq(hrWorkspaceSettingsTable.workspaceId, workspaceId)),
  ]);

  const numberingMode = settings[0]?.numberingMode ?? "auto";
  const isManual = numberingMode === "manual";
  const isHybrid = numberingMode === "hybrid";

  const wb = XLSX.utils.book_new();

  // ── Core field columns ─────────────────────────────────────────────────────
  type ColDef = { key: string; labelEn: string; labelAr: string; required: boolean; format: string };
  const coreCols: ColDef[] = [
    { key: "employee_number",     labelEn: "Employee Number",       labelAr: "رقم الموظف",          required: isManual,  format: isManual ? "Required - enter your number" : isHybrid ? "Optional - leave blank to auto-assign" : "Auto-assigned - leave blank" },
    { key: "full_name",           labelEn: "Full Name",             labelAr: "الاسم الكامل",         required: true,  format: "Text" },
    { key: "first_name",          labelEn: "First Name",            labelAr: "الاسم الأول",          required: false, format: "Text" },
    { key: "last_name",           labelEn: "Last Name",             labelAr: "اسم العائلة",          required: false, format: "Text" },
    { key: "email",               labelEn: "Email",                 labelAr: "البريد الإلكتروني",    required: false, format: "valid@email.com" },
    { key: "phone_number",        labelEn: "Phone Number",          labelAr: "رقم الهاتف",           required: false, format: "+966XXXXXXXXX" },
    { key: "employment_type",     labelEn: "Employment Type",       labelAr: "نوع التوظيف",          required: false, format: "Full Time | Part Time | Contractor (any language/case)" },
    { key: "status",              labelEn: "Status",                labelAr: "الحالة",               required: false, format: "Active | On Leave | Suspended (any language/case)" },
    { key: "hire_date",           labelEn: "Hire Date",             labelAr: "تاريخ التوظيف",        required: false, format: "YYYY-MM-DD" },
    { key: "end_date",            labelEn: "End Date",              labelAr: "تاريخ انتهاء العقد",   required: false, format: "YYYY-MM-DD" },
    { key: "probation_end_date",  labelEn: "Probation End Date",    labelAr: "نهاية فترة الاختبار",  required: false, format: "YYYY-MM-DD" },
    { key: "org_unit_name",       labelEn: "Org Unit / Department", labelAr: "الوحدة التنظيمية",     required: false, format: "Any name — auto-matched or created on import" },
    { key: "job_title_name",      labelEn: "Job Title",             labelAr: "المسمى الوظيفي",       required: false, format: "Any name — auto-matched or created on import" },
    { key: "job_grade_name",      labelEn: "Job Grade",             labelAr: "الدرجة الوظيفية",      required: false, format: "Any name/level e.g. 14 — auto-created if missing" },
    { key: "position_title",      labelEn: "Position",              labelAr: "المنصب",               required: false, format: "Any title — auto-matched or created on import" },
    { key: "direct_manager_num",  labelEn: "Manager Employee #",    labelAr: "رقم المدير المباشر",   required: false, format: "Employee number of the manager" },
    { key: "work_location",       labelEn: "Work Location",         labelAr: "موقع العمل",           required: false, format: "Any name — auto-matched or created on import" },
    { key: "nationality",         labelEn: "Nationality",           labelAr: "الجنسية",              required: false, format: "Text" },
    { key: "gender",              labelEn: "Gender",                labelAr: "الجنس",                required: false, format: "Male | Female | ذكر | أنثى (any case)" },
    { key: "date_of_birth",       labelEn: "Date of Birth",         labelAr: "تاريخ الميلاد",        required: false, format: "YYYY-MM-DD" },
    { key: "marital_status",      labelEn: "Marital Status",        labelAr: "الحالة الاجتماعية",    required: false, format: "single | married | divorced | widowed" },
    { key: "national_id",         labelEn: "National ID",           labelAr: "رقم الهوية",           required: false, format: "Text" },
    { key: "passport_number",     labelEn: "Passport Number",       labelAr: "رقم الجواز",           required: false, format: "Text" },
    { key: "address",             labelEn: "Address",               labelAr: "العنوان",              required: false, format: "Text" },
    { key: "company",             labelEn: "Company",               labelAr: "الشركة",               required: false, format: "Text" },
    { key: "branch",              labelEn: "Branch",                labelAr: "الفرع",                required: false, format: "Text" },
    { key: "notes",               labelEn: "Notes",                 labelAr: "ملاحظات",              required: false, format: "Text" },
    { key: "emergency_name",      labelEn: "Emergency Contact Name",  labelAr: "اسم جهة الطوارئ",    required: false, format: "Text" },
    { key: "emergency_phone",     labelEn: "Emergency Contact Phone", labelAr: "هاتف جهة الطوارئ",   required: false, format: "Text" },
    { key: "emergency_relation",  labelEn: "Emergency Relation",      labelAr: "صلة القرابة للطوارئ",required: false, format: "Text" },
  ];

  // Append custom field columns
  const customCols: ColDef[] = customFields.map((cf) => ({
    key: `cf_${cf.name}`,
    labelEn: cf.label,
    labelAr: cf.labelAr ?? cf.label,
    required: cf.required,
    format: cf.fieldType === "dropdown" ? (cf.options as Array<{value: string}>)?.map((o) => o.value).join(" | ") ?? "Select value"
           : cf.fieldType === "date" ? "YYYY-MM-DD"
           : cf.fieldType === "boolean" ? "true | false"
           : cf.fieldType === "number" ? "Numeric"
           : "Text",
  }));

  const allCols = [...coreCols, ...customCols];

  // ── Sheet 1: Template ──────────────────────────────────────────────────────
  const headerEnRow = allCols.map((c) => c.labelEn);
  const headerArRow = allCols.map((c) => c.labelAr);
  const headerKeyRow = allCols.map((c) => c.key); // internal key row (row 3)
  const exampleRow1 = allCols.map((c) => {
    if (c.key === "employee_number") return isManual ? "5001" : "";
    if (c.key === "full_name") return "Ahmed Al-Rashidi";
    if (c.key === "email") return "ahmed@example.com";
    if (c.key === "employment_type") return "full_time";
    if (c.key === "status") return "active";
    if (c.key === "hire_date") return new Date().toISOString().slice(0, 10);
    if (c.key === "gender") return "male";
    return "";
  });
  const exampleRow2 = allCols.map((c) => {
    if (c.key === "employee_number") return isManual ? "5002" : "";
    if (c.key === "full_name") return "Sara Abdullah";
    if (c.key === "email") return "sara@example.com";
    if (c.key === "employment_type") return "part_time";
    if (c.key === "status") return "active";
    if (c.key === "hire_date") return new Date().toISOString().slice(0, 10);
    if (c.key === "gender") return "female";
    return "";
  });

  const wsTemplate = XLSX.utils.aoa_to_sheet([headerArRow, headerEnRow, headerKeyRow, exampleRow1, exampleRow2]);
  wsTemplate["!cols"] = allCols.map(() => ({ wch: 22 }));
  XLSX.utils.book_append_sheet(wb, wsTemplate, "Employee Template");

  // ── Sheet 2: Instructions ──────────────────────────────────────────────────
  const instrData: string[][] = [
    ["Field (key)", "EN Label", "AR Label", "Required", "Format / Allowed Values"],
    ...allCols.map((c) => [c.key, c.labelEn, c.labelAr, c.required ? "YES ✓" : "no", c.format]),
    [],
    ["NOTES", "", "", "", ""],
    ["• Row 1 = Arabic headers, Row 2 = English headers, Row 3 = internal keys (do not edit)", "", "", "", ""],
    ["• Data starts from Row 4", "", "", "", ""],
    [`• Numbering mode: ${numberingMode.toUpperCase()} - ${isManual ? "you MUST enter employee_number" : isHybrid ? "leave employee_number blank to auto-assign" : "leave employee_number blank (always auto-assigned)"}`, "", "", "", ""],
    ["• Relation columns accept any name — system will match, suggest, or offer to create missing items", "", "", "", ""],
    ["• Custom fields prefixed with cf_ are workspace-specific", "", "", "", ""],
  ];
  const wsInstr = XLSX.utils.aoa_to_sheet(instrData);
  wsInstr["!cols"] = [{ wch: 28 }, { wch: 28 }, { wch: 28 }, { wch: 12 }, { wch: 65 }];
  XLSX.utils.book_append_sheet(wb, wsInstr, "Instructions");

  // ── Sheet 3: Org Units ────────────────────────────────────────────────────
  if (orgUnits.length) {
    const wsOrg = XLSX.utils.aoa_to_sheet([["Org Unit Name (use exactly as shown)"], ...orgUnits.map((o) => [o.name])]);
    wsOrg["!cols"] = [{ wch: 40 }];
    XLSX.utils.book_append_sheet(wb, wsOrg, "Org Units");
  }

  // ── Sheet 4: Job Titles ───────────────────────────────────────────────────
  if (jobTitles.length) {
    const wsJt = XLSX.utils.aoa_to_sheet([["Job Title Name (use exactly as shown)"], ...jobTitles.map((j) => [j.name])]);
    wsJt["!cols"] = [{ wch: 40 }];
    XLSX.utils.book_append_sheet(wb, wsJt, "Job Titles");
  }

  // ── Sheet 5: Job Grades ───────────────────────────────────────────────────
  if (jobGrades.length) {
    const wsJg = XLSX.utils.aoa_to_sheet([["Job Grade Name (use exactly as shown)", "Code"], ...jobGrades.map((g) => [g.name, g.code ?? ""])]);
    wsJg["!cols"] = [{ wch: 30 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, wsJg, "Job Grades");
  }

  // ── Sheet 6: Work Locations ───────────────────────────────────────────────
  if (workLocations.length) {
    const wsWl = XLSX.utils.aoa_to_sheet([["Work Location Name (use exactly as shown)"], ...workLocations.map((w) => [w.name])]);
    wsWl["!cols"] = [{ wch: 40 }];
    XLSX.utils.book_append_sheet(wb, wsWl, "Work Locations");
  }

  // ── Sheet 7: Positions ────────────────────────────────────────────────────
  if (positions.length) {
    const wsPos = XLSX.utils.aoa_to_sheet([["Position Title (use exactly as shown)"], ...positions.map((p) => [p.title])]);
    wsPos["!cols"] = [{ wch: 40 }];
    XLSX.utils.book_append_sheet(wb, wsPos, "Positions");
  }

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  void getImportRuntimeSettings(workspaceId).then((runtimeSettings) =>
    recordImportTelemetry({
      workspaceId,
      phase: "template",
      sourcePath: "GET /hr/employees/import-template",
      runtimeSettings,
      metrics: { rowCount: 0 },
    }),
  );
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="employee_import_template.xlsx"`);
  res.send(buf);
});

// ── POST /hr/employees/import/preview ─────────────────────────────────────────

router.post("/hr/employees/import/preview", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  try {
  const governance = await getEmployeeImportGovernanceSettings(workspaceId);
  if (governance.readinessGateEnabled) {
    try {
      await assertFoundationReadinessForImport(workspaceId);
    } catch (e) {
      const err = e as Error & { code?: string; readiness?: unknown };
      if (err.code === "FOUNDATION_NOT_READY") {
        res.status(409).json({
          error: "FOUNDATION_NOT_READY",
          message: err.message,
          readiness: err.readiness,
        });
        return;
      }
      throw e;
    }
  }

  const rawRows: Record<string, string>[] = Array.isArray(req.body.rows) ? req.body.rows : [];

  // Load reference lookups in parallel (dynamic enums merged with legacy fallback)
  const [orgUnits, jobTitles, jobGrades, positions, workLocations, customFields, existingEmps, settings, employmentTypesDynamic, statusesDynamic, importRuntimeSettings] = await Promise.all([
    db.select({ id: hrOrgUnitsTable.id, name: hrOrgUnitsTable.name, code: hrOrgUnitsTable.code }).from(hrOrgUnitsTable).where(eq(hrOrgUnitsTable.workspaceId, workspaceId)),
    db.select({ id: hrJobTitlesTable.id, name: hrJobTitlesTable.name, code: hrJobTitlesTable.code }).from(hrJobTitlesTable).where(eq(hrJobTitlesTable.workspaceId, workspaceId)),
    db.select({ id: hrJobGradesTable.id, name: hrJobGradesTable.name, code: hrJobGradesTable.code }).from(hrJobGradesTable).where(eq(hrJobGradesTable.workspaceId, workspaceId)),
    db.select({ id: hrPositionsTable.id, title: hrPositionsTable.title, code: hrPositionsTable.code }).from(hrPositionsTable).where(eq(hrPositionsTable.workspaceId, workspaceId)),
    db.select({ id: hrWorkLocationsTable.id, name: hrWorkLocationsTable.name, code: hrWorkLocationsTable.code }).from(hrWorkLocationsTable).where(eq(hrWorkLocationsTable.workspaceId, workspaceId)),
    db.select({ name: hrCustomFieldDefsTable.name, id: hrCustomFieldDefsTable.id, fieldType: hrCustomFieldDefsTable.fieldType, required: hrCustomFieldDefsTable.required }).from(hrCustomFieldDefsTable).where(and(eq(hrCustomFieldDefsTable.workspaceId, workspaceId), eq(hrCustomFieldDefsTable.isActive, true))),
    db.select({ id: employeesTable.id, employeeNumber: employeesTable.employeeNumber, email: employeesTable.email, fullName: employeesTable.fullName }).from(employeesTable).where(eq(employeesTable.workspaceId, workspaceId)),
    db.select().from(hrWorkspaceSettingsTable).where(eq(hrWorkspaceSettingsTable.workspaceId, workspaceId)),
    loadDynamicEmploymentTypes(workspaceId),
    loadDynamicEmployeeStatuses(workspaceId),
    getImportRuntimeSettings(workspaceId),
  ]);

  const numberingMode = settings[0]?.numberingMode ?? "auto";
  const lookupMaps = buildMasterDataLookupMaps({ orgUnits, jobTitles, jobGrades, positions, workLocations });

  const empByNum  = new Map(existingEmps.map((e) => [String(e.employeeNumber ?? "").toLowerCase(), e]));
  const empByEmail = new Map(existingEmps.map((e) => [String(e.email ?? "").toLowerCase(), e]));

  const cfByName = new Map(customFields.map((c) => [c.name, c]));

  const getField = (row: Record<string, string>, ...keys: string[]): string => {
    for (const k of keys) { if (row[k] !== undefined && row[k] !== "") return String(row[k]).trim(); }
    return "";
  };

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  type PreviewRow = {
    rowIndex: number;
    status: "new" | "update" | "error" | "skip" | "staged";
    existingEmployeeId?: number;
    errors: string[];
    warnings: string[];
    data: Record<string, unknown>;
    mismatchFields?: Array<Record<string, unknown>>;
  };

  const previewRows: PreviewRow[] = [];

  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i]!;
    const errors: string[] = [];
    const warnings: string[] = [];

    const fullName = getField(row, "full_name", "الاسم الكامل", "Full Name");
    const email    = getField(row, "email", "البريد الإلكتروني", "Email");
    const empNum   = getField(row, "employee_number", "رقم الموظف", "Employee Number");
    const empType  = getField(row, "employment_type", "نوع التوظيف", "Employment Type");
    const status   = getField(row, "status", "الحالة", "Status");
    const hireDate = getField(row, "hire_date", "تاريخ التوظيف", "Hire Date");
    const endDate  = getField(row, "end_date", "تاريخ انتهاء العقد", "End Date");
    const probDate = getField(row, "probation_end_date", "نهاية فترة الاختبار", "Probation End Date");
    const dob      = getField(row, "date_of_birth", "تاريخ الميلاد", "Date of Birth");
    const gender   = getField(row, "gender", "الجنس", "Gender");
    const orgName  = getField(row, "org_unit_name", "الوحدة التنظيمية", "Org Unit / Department");
    const orgCode  = getField(row, "org_unit_code", "كود الوحدة", "Org Unit Code");
    const jtName   = getField(row, "job_title_name", "المسمى الوظيفي", "Job Title");
    const jtCode   = getField(row, "job_title_code", "كود المسمى", "Job Title Code");
    const jgName   = getField(row, "job_grade_name", "الدرجة الوظيفية", "Job Grade");
    const jgCode   = getField(row, "job_grade_code", "كود الدرجة", "Job Grade Code");
    const posName  = getField(row, "position_title", "المنصب", "Position");
    const posCode  = getField(row, "position_code", "كود المنصب", "Position Code");
    const wlName   = getField(row, "work_location", "موقع العمل", "Work Location");
    const wlCode   = getField(row, "work_location_code", "كود الموقع", "Work Location Code");
    const mgrNum   = getField(row, "direct_manager_num", "رقم المدير المباشر", "Manager Employee #");

    if (!fullName) { errors.push("full_name is required"); }

    // Employee number validation
    if (numberingMode === "manual" && !empNum) errors.push("employee_number is required (manual mode)");
    if (empNum) {
      const existing = empByNum.get(empNum.toLowerCase());
      if (existing) warnings.push(`employee_number "${empNum}" already exists - will update record`);
    }

    // Email
    if (email && !EMAIL_RE.test(email)) errors.push(`Invalid email: ${email}`);
    if (email && empByEmail.has(email.toLowerCase())) {
      const ex = empByEmail.get(email.toLowerCase())!;
      if (!empNum || String(ex.employeeNumber ?? "").toLowerCase() !== empNum.toLowerCase()) {
        warnings.push(`email "${email}" already exists for ${ex.fullName}`);
      }
    }

    // Type / status / gender — human-friendly values normalized by import intelligence (below)

    // Dates
    for (const [lbl, val] of [["hire_date", hireDate], ["end_date", endDate], ["probation_end_date", probDate], ["date_of_birth", dob]] as [string, string][]) {
      if (val && !DATE_RE.test(val)) errors.push(`Invalid ${lbl}: "${val}" - expected YYYY-MM-DD`);
    }

    const resolved = resolveMasterDataIds({
      orgName, orgCode, jtName, jtCode, jgName, jgCode, posName, posCode, wlName, wlCode, maps: lookupMaps,
    });
    const mismatches = governance.matchOnly
      ? detectMasterDataMismatches({ orgName, orgCode, jtName, jtCode, jgName, jgCode, posName, posCode, wlName, wlCode, maps: lookupMaps })
      : [];

    if (!governance.matchOnly) {
      if (orgName && resolved.orgUnitId === undefined)  warnings.push(`org_unit_name "${orgName}" not found - will be ignored`);
      if (jtName  && resolved.jobTitleId === undefined)   warnings.push(`job_title_name "${jtName}" not found - will be ignored`);
      if (jgName  && resolved.jobGradeId === undefined)   warnings.push(`job_grade_name "${jgName}" not found - will be ignored`);
      if (posName && resolved.positionId === undefined)  warnings.push(`position_title "${posName}" not found - will be ignored`);
      if (wlName  && !resolved.workLocationId) warnings.push(`work_location "${wlName}" not found - will be ignored`);
    } else if (mismatches.length > 0) {
      for (const m of mismatches) {
        errors.push(`MASTER_DATA_NOT_FOUND: ${m.labelEn} "${m.value}" is not in Foundation`);
      }
    }
    if (mgrNum) {
      const mgr = empByNum.get(mgrNum.toLowerCase());
      if (!mgr) warnings.push(`manager employee_number "${mgrNum}" not found - will be ignored`);
    }

    // Custom fields
    const customValues: Record<string, string> = {};
    for (const cf of customFields) {
      const val = getField(row, `cf_${cf.name}`, cf.name);
      if (cf.required && !val) errors.push(`Custom field "${cf.name}" is required`);
      if (val) customValues[cf.name] = val;
    }

    // Determine if new or update
    const existingByNum = empNum ? empByNum.get(empNum.toLowerCase()) : undefined;
    const existingByMail = email ? empByEmail.get(email.toLowerCase()) : undefined;
    const existing = existingByNum ?? existingByMail;

    const nonMasterErrors = errors.filter((e) => !e.startsWith("MASTER_DATA_NOT_FOUND"));
    let rowStatus: PreviewRow["status"];
    if (nonMasterErrors.length > 0) rowStatus = "error";
    else if (governance.matchOnly && mismatches.length > 0) rowStatus = "staged";
    else if (existing) rowStatus = "update";
    else rowStatus = "new";

    previewRows.push({
      rowIndex: i + 1,
      status: rowStatus,
      existingEmployeeId: existing?.id,
      errors,
      warnings,
      mismatchFields: mismatches,
      data: {
        fullName,
        firstName: getField(row, "first_name", "الاسم الأول", "First Name"),
        lastName:  getField(row, "last_name", "اسم العائلة", "Last Name"),
        email: email || null,
        phoneNumber: getField(row, "phone_number", "رقم الهاتف", "Phone Number") || null,
        employeeNumber: empNum || null,
        employmentType: empType || "full_time",
        status: status || "active",
        hireDate: hireDate || null,
        endDate: endDate || null,
        probationEndDate: probDate || null,
        dateOfBirth: dob || null,
        gender: gender || null,
        nationality: getField(row, "nationality", "الجنسية", "Nationality") || null,
        maritalStatus: getField(row, "marital_status", "الحالة الاجتماعية", "Marital Status") || null,
        nationalId: getField(row, "national_id", "رقم الهوية", "National ID") || null,
        passportNumber: getField(row, "passport_number", "رقم الجواز", "Passport Number") || null,
        address: getField(row, "address", "العنوان", "Address") || null,
        company: getField(row, "company", "الشركة", "Company") || null,
        branch: getField(row, "branch", "الفرع", "Branch") || null,
        notes: getField(row, "notes", "ملاحظات", "Notes") || null,
        emergencyContactName: getField(row, "emergency_name", "اسم جهة الطوارئ", "Emergency Contact Name") || null,
        emergencyContactPhone: getField(row, "emergency_phone", "هاتف جهة الطوارئ", "Emergency Contact Phone") || null,
        emergencyContactRelation: getField(row, "emergency_relation", "صلة القرابة للطوارئ", "Emergency Relation") || null,
        orgUnitId: resolved.orgUnitId ?? null,
        orgUnitName: orgName || null,
        orgUnitCode: orgCode || null,
        jobTitleId: resolved.jobTitleId ?? null,
        jobTitleName: jtName || null,
        jobTitleCode: jtCode || null,
        jobGradeId: resolved.jobGradeId ?? null,
        jobGradeName: jgName || null,
        jobGradeCode: jgCode || null,
        positionId: resolved.positionId ?? null,
        positionTitle: posName || null,
        positionCode: posCode || null,
        workLocationName: wlName || null,
        workLocationCode: wlCode || null,
        location: resolved.workLocationName ?? (wlName || null),
        managerEmployeeNumber: mgrNum || null,
        customValues,
      },
    });
  }

  let finalPreviewRows = previewRows;
  let importIntelligence: Awaited<ReturnType<typeof applyImportPreviewIntelligence>>["intelligence"] = {
    autoFixes: [],
    normalizedEnums: [],
    matchedEntities: [],
    proposeCreate: [],
    deferredManagers: [],
    unrecognizedValues: [],
  };
  let proposalSummary: Awaited<ReturnType<typeof applyImportPreviewIntelligence>>["proposalSummary"] = [];
  let enterprisePreview: Awaited<ReturnType<typeof buildEnterpriseImportPreview>> = {
    rows: previewRows,
    enterprise: null,
    enterpriseActive: false,
  };
  let enterpriseStatus: Awaited<ReturnType<typeof getEnterpriseRuntimeStatus>> | null = null;

  try {
    const intelligencePreview = await applyImportPreviewIntelligence({
      workspaceId,
      previewRows,
      rawRows,
      employmentTypes: employmentTypesDynamic,
      statuses: statusesDynamic,
    });
    finalPreviewRows = intelligencePreview.rows;
    importIntelligence = intelligencePreview.intelligence;
    proposalSummary = intelligencePreview.proposalSummary;

    enterprisePreview = await buildEnterpriseImportPreview({
      workspaceId,
      previewRows: finalPreviewRows,
      rawRows,
    });
    finalPreviewRows = enterprisePreview.rows;
    enterpriseStatus = await getEnterpriseRuntimeStatus(workspaceId);
  } catch (e) {
    if (isSchemaMismatchError(e)) {
      logger.warn({ workspaceId, err: e }, "Enterprise preview hook skipped — import runtime schema incomplete");
    } else {
      throw e;
    }
  }

  const summary = {
    total: finalPreviewRows.length,
    new: finalPreviewRows.filter((r) => r.status === "new").length,
    update: finalPreviewRows.filter((r) => r.status === "update").length,
    errors: finalPreviewRows.filter((r) => r.status === "error").length,
    staged: finalPreviewRows.filter((r) => r.status === "staged").length,
  };

  const allWarnings = finalPreviewRows.flatMap((r) => r.warnings);
  const unresolvedMetrics = countUnresolvedFromWarnings(allWarnings);

  const shadowResult = await runShadowValidationPipeline({
    workspaceId,
    numberingMode,
    runtimeSettings: importRuntimeSettings,
    rawRows,
    legacyPreviewRows: finalPreviewRows.map((r) => ({
      rowIndex: r.rowIndex,
      errors: r.errors,
      warnings: r.warnings,
      status: r.status,
    })),
    sourcePath: "POST /hr/employees/import/preview",
  });

  void recordImportTelemetry({
    workspaceId,
    phase: "preview",
    sourcePath: "POST /hr/employees/import/preview",
    runtimeSettings: importRuntimeSettings,
    metrics: {
      rowCount: finalPreviewRows.length,
      newCount: summary.new,
      updateCount: summary.update,
      errorCount: summary.errors,
      warningCount: allWarnings.length,
      validationErrors: summary.errors,
      ...unresolvedMetrics,
      dynamicEnumSource: employmentTypesDynamic.source,
      employmentTypeCount: employmentTypesDynamic.codes.size,
      statusCount: statusesDynamic.codes.size,
      shadowValidationRan: shadowResult.ran,
      shadowParityRatio: shadowResult.summary?.parityRatio,
      shadowMismatchedRows: shadowResult.summary?.mismatchedRows,
    },
  });

  res.json({
    rows: finalPreviewRows,
    summary,
    governance,
    importIntelligence,
    proposalSummary,
    enterprise: enterprisePreview.enterprise,
    enterpriseRuntime: enterpriseStatus,
  });
  } catch (e) {
    if (isSchemaMismatchError(e)) {
      logger.warn({ workspaceId, err: e }, "Employee import preview blocked by schema");
      res.status(503).json({
        error: "HR_IMPORT_RUNTIME_SCHEMA_UNAVAILABLE",
        message: e instanceof Error ? e.message : "Import runtime schema is not available on this server.",
        migrationHint: "Run: node scripts/migrate-hr-import-runtime.cjs && node scripts/migrate-hr-import-auto-create-phase5.cjs && node scripts/migrate-platform-runtime-final-phase.cjs",
      });
      return;
    }
    logger.error({ workspaceId, err: e }, "Employee import preview failed");
    res.status(500).json({
      error: "IMPORT_PREVIEW_FAILED",
      message: e instanceof Error ? e.message : "Import preview failed",
    });
  }
});

// ── POST /hr/employees/import/confirm ─────────────────────────────────────────

router.post("/hr/employees/import/confirm", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  const governance = await getEmployeeImportGovernanceSettings(workspaceId);
  if (governance.readinessGateEnabled) {
    try {
      await assertFoundationReadinessForImport(workspaceId);
    } catch (e) {
      const err = e as Error & { code?: string; readiness?: unknown };
      if (err.code === "FOUNDATION_NOT_READY") {
        res.status(409).json({ error: "FOUNDATION_NOT_READY", message: err.message, readiness: err.readiness });
        return;
      }
      throw e;
    }
  }

  const rows: Array<{
    status: "new" | "update" | "skip" | "staged";
    existingEmployeeId?: number;
    data: Record<string, unknown>;
    mismatchFields?: Array<Record<string, unknown>>;
    errors?: string[];
    warnings?: string[];
    rowIndex?: number;
  }> = Array.isArray(req.body.rows) ? req.body.rows : [];

  const stagedRows = rows.filter((r) => r.status === "staged");
  const commitInputRows = rows.filter((r) => r.status !== "staged");

  const [settings, allEmps, importRuntimeSettings] = await Promise.all([
    db.select().from(hrWorkspaceSettingsTable).where(eq(hrWorkspaceSettingsTable.workspaceId, workspaceId)),
    db.select({ id: employeesTable.id, employeeNumber: employeesTable.employeeNumber }).from(employeesTable).where(eq(employeesTable.workspaceId, workspaceId)),
    getImportRuntimeSettings(workspaceId),
  ]);
  const numberingMode = settings[0]?.numberingMode ?? "auto";
  const empByNum = new Map(allEmps.map((e) => [String(e.employeeNumber ?? "").toLowerCase(), e.id]));

  const approveEntityCreates = req.body.approveEntityCreates === true;

  let enterpriseResolution: Awaited<ReturnType<typeof applyEnterpriseConfirmResolution>> = {
    rows: commitInputRows as Array<{ status: "new" | "update" | "skip"; existingEmployeeId?: number; data: Record<string, unknown> }>,
    created: 0,
    queued: 0,
    skipped: 0,
    enterpriseActive: false,
  };
  try {
    enterpriseResolution = await applyEnterpriseConfirmResolution({
      workspaceId,
      rows: commitInputRows as Array<{ status: "new" | "update" | "skip"; existingEmployeeId?: number; data: Record<string, unknown> }>,
      approveEntityCreates,
      userId: req.userId,
    });
  } catch (e) {
    if (isSchemaMismatchError(e)) {
      logger.warn({ workspaceId, err: e }, "Enterprise confirm hook skipped — import runtime schema incomplete");
      enterpriseResolution = { rows: commitInputRows as typeof enterpriseResolution.rows, created: 0, queued: 0, skipped: 0, enterpriseActive: false };
    } else {
      throw e;
    }
  }
  const commitRows = enterpriseResolution.rows;

  let staged = 0;
  let stagingBatchId: string | undefined;
  if (governance.stagingEnabled && stagedRows.length > 0) {
    const batch = await insertStagingBatch({
      workspaceId,
      reviewedByUserId: req.userId,
      rows: stagedRows.map((r, idx) => ({
        rowIndex: r.rowIndex ?? idx + 1,
        normalizedRow: r.data,
        mismatchFields: (r.mismatchFields ?? []) as Array<Record<string, unknown>>,
        errors: r.errors ?? [],
        warnings: r.warnings ?? [],
        existingEmployeeId: r.existingEmployeeId,
        intendedStatus: r.existingEmployeeId ? "update" : "new",
      })),
    });
    staged = batch.inserted;
    stagingBatchId = batch.batchId;
  }

  let imported = 0; let updated = 0;
  const errors: string[] = [];
  const deferredManagerLinks: Array<{ employeeId: number; managerEmployeeNumber?: string | null }> = [];

  for (const row of commitRows) {
    if (row.status === "skip") continue;
    try {
      const d = row.data as Record<string, unknown>;
      const mgrNum = String(d.deferredManagerEmployeeNumber ?? d.managerEmployeeNumber ?? "").trim();
      const managerId = mgrNum ? (empByNum.get(mgrNum.toLowerCase()) ?? null) : null;

      // Determine employee number
      let empNumber: string;
      if (row.status === "new") {
        if (numberingMode === "manual" || (numberingMode === "hybrid" && d.employeeNumber)) {
          empNumber = String(d.employeeNumber ?? "").trim();
          if (!empNumber) { errors.push(`Row skipped - employeeNumber required in ${numberingMode} mode`); continue; }
          // sync counter
          if (/^\d+$/.test(empNumber)) {
            const n = parseInt(empNumber, 10);
            await db.execute(sql`INSERT INTO hr_workspace_counters (workspace_id, counter_name, current_value) VALUES (${workspaceId}, 'employee_number', ${n}) ON CONFLICT (workspace_id, counter_name) DO UPDATE SET current_value = GREATEST(hr_workspace_counters.current_value, ${n})`);
          }
        } else {
          empNumber = await generateEmployeeNumber(workspaceId);
        }
      } else {
        empNumber = String(d.employeeNumber ?? "").trim();
      }

      if (row.status === "new") {
        const [inserted] = await db.insert(employeesTable).values({
          workspaceId,
          fullName: String(d.fullName ?? "").trim(),
          firstName: d.firstName ? String(d.firstName) : null,
          lastName: d.lastName ? String(d.lastName) : null,
          email: d.email ? String(d.email) : null,
          phoneNumber: d.phoneNumber ? String(d.phoneNumber) : null,
          employeeNumber: empNumber,
          status: (d.status as string) ?? "active",
          employmentType: (d.employmentType as string) ?? "full_time",
          hireDate: d.hireDate ? String(d.hireDate) : null,
          endDate: d.endDate ? String(d.endDate) : null,
          probationEndDate: d.probationEndDate ? String(d.probationEndDate) : null,
          dateOfBirth: d.dateOfBirth ? String(d.dateOfBirth) : null,
          gender: d.gender ? String(d.gender) : null,
          nationality: d.nationality ? String(d.nationality) : null,
          maritalStatus: d.maritalStatus ? String(d.maritalStatus) : null,
          nationalId: d.nationalId ? String(d.nationalId) : null,
          passportNumber: d.passportNumber ? String(d.passportNumber) : null,
          address: d.address ? String(d.address) : null,
          company: d.company ? String(d.company) : null,
          branch: d.branch ? String(d.branch) : null,
          location: d.location ? String(d.location) : (d.workLocationName ? String(d.workLocationName) : null),
          orgUnitId: d.orgUnitId ? Number(d.orgUnitId) : null,
          jobTitleId: d.jobTitleId ? Number(d.jobTitleId) : null,
          jobGradeId: d.jobGradeId ? Number(d.jobGradeId) : null,
          positionId: d.positionId ? Number(d.positionId) : null,
          workLocationId: d.workLocationId ? Number(d.workLocationId) : null,
          position: d.positionTitle ? String(d.positionTitle) : null,
          directManagerId: managerId,
          emergencyContactName: d.emergencyContactName ? String(d.emergencyContactName) : null,
          emergencyContactPhone: d.emergencyContactPhone ? String(d.emergencyContactPhone) : null,
          emergencyContactRelation: d.emergencyContactRelation ? String(d.emergencyContactRelation) : null,
          notes: d.notes ? String(d.notes) : null,
        }).returning();

        // Save custom field values
        const cvs = d.customValues as Record<string, string> | undefined;
        if (inserted && cvs && Object.keys(cvs).length > 0) {
          const cfDefs = await db.select({ id: hrCustomFieldDefsTable.id, name: hrCustomFieldDefsTable.name })
            .from(hrCustomFieldDefsTable).where(eq(hrCustomFieldDefsTable.workspaceId, workspaceId));
          for (const [cfName, cfVal] of Object.entries(cvs)) {
            const def = cfDefs.find((c) => c.name === cfName);
            if (def && cfVal) {
              await db.insert(hrCustomFieldValuesTable).values({ employeeId: inserted.id, fieldDefId: def.id, value: String(cfVal) }).onConflictDoUpdate({ target: [hrCustomFieldValuesTable.employeeId, hrCustomFieldValuesTable.fieldDefId], set: { value: String(cfVal) } });
            }
          }
        }
        empByNum.set(String(empNumber).toLowerCase(), inserted!.id);
        if (mgrNum && !managerId) {
          deferredManagerLinks.push({ employeeId: inserted!.id, managerEmployeeNumber: mgrNum });
        }
        imported++;
      } else if (row.status === "update" && row.existingEmployeeId) {
        await db.update(employeesTable).set({
          fullName: String(d.fullName ?? "").trim(),
          firstName: d.firstName ? String(d.firstName) : null,
          lastName: d.lastName ? String(d.lastName) : null,
          email: d.email ? String(d.email) : null,
          phoneNumber: d.phoneNumber ? String(d.phoneNumber) : null,
          status: (d.status as string) ?? "active",
          employmentType: (d.employmentType as string) ?? "full_time",
          hireDate: d.hireDate ? String(d.hireDate) : null,
          endDate: d.endDate ? String(d.endDate) : null,
          probationEndDate: d.probationEndDate ? String(d.probationEndDate) : null,
          dateOfBirth: d.dateOfBirth ? String(d.dateOfBirth) : null,
          gender: d.gender ? String(d.gender) : null,
          nationality: d.nationality ? String(d.nationality) : null,
          maritalStatus: d.maritalStatus ? String(d.maritalStatus) : null,
          nationalId: d.nationalId ? String(d.nationalId) : null,
          passportNumber: d.passportNumber ? String(d.passportNumber) : null,
          address: d.address ? String(d.address) : null,
          company: d.company ? String(d.company) : null,
          branch: d.branch ? String(d.branch) : null,
          location: d.location ? String(d.location) : (d.workLocationName ? String(d.workLocationName) : null),
          orgUnitId: d.orgUnitId ? Number(d.orgUnitId) : null,
          jobTitleId: d.jobTitleId ? Number(d.jobTitleId) : null,
          jobGradeId: d.jobGradeId ? Number(d.jobGradeId) : null,
          positionId: d.positionId ? Number(d.positionId) : null,
          workLocationId: d.workLocationId ? Number(d.workLocationId) : null,
          position: d.positionTitle ? String(d.positionTitle) : null,
          directManagerId: managerId,
          emergencyContactName: d.emergencyContactName ? String(d.emergencyContactName) : null,
          emergencyContactPhone: d.emergencyContactPhone ? String(d.emergencyContactPhone) : null,
          emergencyContactRelation: d.emergencyContactRelation ? String(d.emergencyContactRelation) : null,
          notes: d.notes ? String(d.notes) : null,
        }).where(and(eq(employeesTable.id, row.existingEmployeeId), eq(employeesTable.workspaceId, workspaceId)));
        const cvs = d.customValues as Record<string, string> | undefined;
        if (cvs && Object.keys(cvs).length > 0) {
          const cfDefs = await db.select({ id: hrCustomFieldDefsTable.id, name: hrCustomFieldDefsTable.name })
            .from(hrCustomFieldDefsTable).where(eq(hrCustomFieldDefsTable.workspaceId, workspaceId));
          for (const [cfName, cfVal] of Object.entries(cvs)) {
            const def = cfDefs.find((c) => c.name === cfName);
            if (def && cfVal) {
              await db.insert(hrCustomFieldValuesTable).values({ employeeId: row.existingEmployeeId, fieldDefId: def.id, value: String(cfVal) }).onConflictDoUpdate({ target: [hrCustomFieldValuesTable.employeeId, hrCustomFieldValuesTable.fieldDefId], set: { value: String(cfVal) } });
            }
          }
        }
        if (mgrNum && !managerId) {
          deferredManagerLinks.push({ employeeId: row.existingEmployeeId, managerEmployeeNumber: mgrNum });
        }
        updated++;
      }
    } catch (e: unknown) {
      errors.push(`Row ${imported + updated + errors.length + 1}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  let managerLinkResult = { linked: 0, pending: 0 };
  try {
    managerLinkResult = await applyDeferredManagerLinks({ workspaceId, employeeIds: deferredManagerLinks });
  } catch (e) {
    logger.warn({ workspaceId, err: e }, "Deferred manager linking pass failed — import rows committed");
  }

  void recordImportTelemetry({
    workspaceId,
    phase: "confirm",
    sourcePath: "POST /hr/employees/import/confirm",
    runtimeSettings: importRuntimeSettings,
    metrics: {
      rowCount: commitRows.length,
      imported,
      updated,
      confirmErrors: errors.length,
      errorCount: errors.length,
      enterpriseEntitiesCreated: enterpriseResolution.created,
      enterpriseEntitiesQueued: enterpriseResolution.queued,
      enterpriseEntitiesSkipped: enterpriseResolution.skipped,
      enterpriseActive: enterpriseResolution.enterpriseActive,
      deferredManagersLinked: managerLinkResult.linked,
      deferredManagersPending: managerLinkResult.pending,
    },
  });

  res.json({
    imported,
    updated,
    staged,
    stagingBatchId,
    errors,
    importIntelligence: {
      entitiesCreated: enterpriseResolution.created,
      entitiesQueued: enterpriseResolution.queued,
      entitiesSkipped: enterpriseResolution.skipped,
      deferredManagersLinked: managerLinkResult.linked,
      deferredManagersPending: managerLinkResult.pending,
    },
    enterprise: {
      active: enterpriseResolution.enterpriseActive,
      entitiesCreated: enterpriseResolution.created,
      entitiesQueued: enterpriseResolution.queued,
      entitiesSkipped: enterpriseResolution.skipped,
    },
  });
});

// ── GET /hr/employees/export ───────────────────────────────────────────────────

router.get("/hr/employees/export", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const q = req.query as Record<string, string>;
  const mode = q.mode === "async" || q.mode === "sync" ? q.mode : "auto";
  try {
    await reportService.handleLegacyExport(req, res, {
      reportDefinitionKey: "hr.employees.roster",
      format: q.format ?? "xlsx",
      parameters: {
        orgUnitId: q.orgUnitId,
        status: q.status,
        employmentType: q.employmentType,
      },
      mode,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Export failed";
    res.status(message === "Forbidden" ? 403 : 400).json({ error: message });
  }
});

// ── POST /hr/employees/bulk ────────────────────────────────────────────────────

router.post("/hr/employees/bulk", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  const { action, employeeIds, value } = req.body as {
    action: string;
    employeeIds: number[];
    value?: string;
  };

  if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
    res.status(400).json({ error: "employeeIds must be a non-empty array" }); return;
  }

  const validActions = new Set(["set_status", "set_employment_type", "set_org_unit", "set_job_title", "delete"]);
  if (!validActions.has(action)) {
    res.status(400).json({ error: `Unknown action: ${action}` }); return;
  }

  let affected = 0;

  for (const empId of employeeIds) {
    const [emp] = await db.select({ id: employeesTable.id }).from(employeesTable)
      .where(and(eq(employeesTable.id, empId), eq(employeesTable.workspaceId, workspaceId)));
    if (!emp) continue;

    if (action === "set_status" && value) {
      const [before] = await db.select({ status: employeesTable.status })
        .from(employeesTable)
        .where(and(eq(employeesTable.id, empId), eq(employeesTable.workspaceId, workspaceId)));
      await db.update(employeesTable).set({ status: value }).where(eq(employeesTable.id, empId));
      void maybeDeactivateLinkedUserOnTermination({
        workspaceId,
        employeeId: empId,
        newStatus: value,
        previousStatus: before?.status,
        actorUserId: req.userId,
      }).catch(() => undefined);
      affected++;
    } else if (action === "set_employment_type" && value) {
      await db.update(employeesTable).set({ employmentType: value }).where(eq(employeesTable.id, empId));
      affected++;
    } else if (action === "set_org_unit" && value) {
      await db.update(employeesTable).set({ orgUnitId: parseInt(value) }).where(eq(employeesTable.id, empId));
      affected++;
    } else if (action === "set_job_title" && value) {
      await db.update(employeesTable).set({ jobTitleId: parseInt(value) }).where(eq(employeesTable.id, empId));
      affected++;
    } else if (action === "delete") {
      await db.delete(employeesTable).where(and(eq(employeesTable.id, empId), eq(employeesTable.workspaceId, workspaceId)));
      affected++;
    }
  }

  res.json({ affected });
});

// ── GET /hr/employees/:id ──────────────────────────────────────────────────────

router.get("/hr/employees/:id", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  const [row] = await db
    .select({
      id:                        employeesTable.id,
      workspaceId:               employeesTable.workspaceId,
      userId:                    employeesTable.userId,
      employeeNumber:            employeesTable.employeeNumber,
      firstName:                 employeesTable.firstName,
      lastName:                  employeesTable.lastName,
      fullName:                  employeesTable.fullName,
      email:                     employeesTable.email,
      phoneNumber:               employeesTable.phoneNumber,
      avatarUrl:                 employeesTable.avatarUrl,
      status:                    employeesTable.status,
      nationality:               employeesTable.nationality,
      gender:                    employeesTable.gender,
      dateOfBirth:               employeesTable.dateOfBirth,
      maritalStatus:             employeesTable.maritalStatus,
      address:                   employeesTable.address,
      nationalId:                employeesTable.nationalId,
      passportNumber:            employeesTable.passportNumber,
      employmentType:            employeesTable.employmentType,
      hireDate:                  employeesTable.hireDate,
      endDate:                   employeesTable.endDate,
      probationEndDate:          employeesTable.probationEndDate,
      orgUnitId:                 employeesTable.orgUnitId,
      orgUnitName:               hrOrgUnitsTable.name,
      jobTitleId:                employeesTable.jobTitleId,
      jobTitleName:              hrJobTitlesTable.name,
      jobGradeId:                employeesTable.jobGradeId,
      jobGradeName:              hrJobGradesTable.name,
      jobGradeCode:              hrJobGradesTable.code,
      position:                  employeesTable.position,
      directManagerId:           employeesTable.directManagerId,
      managerName:               managerAlias.fullName,
      managerAvatarUrl:          managerAlias.avatarUrl,
      company:                   employeesTable.company,
      branch:                    employeesTable.branch,
      location:                  employeesTable.location,
      emergencyContactName:      employeesTable.emergencyContactName,
      emergencyContactPhone:     employeesTable.emergencyContactPhone,
      emergencyContactRelation:  employeesTable.emergencyContactRelation,
      leaveBalances:             employeesTable.leaveBalances,
      onboardingData:            employeesTable.onboardingData,
      notes:                     employeesTable.notes,
      createdAt:                 employeesTable.createdAt,
      updatedAt:                 employeesTable.updatedAt,
    })
    .from(employeesTable)
    .leftJoin(hrOrgUnitsTable, eq(employeesTable.orgUnitId, hrOrgUnitsTable.id))
    .leftJoin(hrJobTitlesTable, eq(employeesTable.jobTitleId, hrJobTitlesTable.id))
    .leftJoin(hrJobGradesTable, eq(employeesTable.jobGradeId, hrJobGradesTable.id))
    .leftJoin(managerAlias, eq(employeesTable.directManagerId, managerAlias.id))
    .where(and(eq(employeesTable.id, id), eq(employeesTable.workspaceId, workspaceId)));

  if (!row) { res.status(404).json({ error: "Employee not found" }); return; }

  res.json(row);
});

// ── POST /hr/employees ─────────────────────────────────────────────────────────

router.post("/hr/employees", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  const bodyParsed = HrEmployeeCreateBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: formatZodError(bodyParsed.error) });
    return;
  }

  const body = bodyParsed.data;
  const {
    fullName, firstName, lastName, email, phoneNumber,
    avatarUrl, status, nationality, gender, dateOfBirth, maritalStatus,
    address, nationalId, passportNumber, employmentType, hireDate,
    endDate, probationEndDate, orgUnitId, jobTitleId, jobGradeId,
    position, directManagerId, company, branch, location,
    emergencyContactName, emergencyContactPhone, emergencyContactRelation,
    notes, userId,
  } = body;

  if (!fullName?.trim()) { res.status(400).json({ error: "fullName is required" }); return; }

  // Resolve numbering mode for this workspace
  const [settings] = await db.select().from(hrWorkspaceSettingsTable).where(eq(hrWorkspaceSettingsTable.workspaceId, workspaceId));
  const numberingMode = settings?.numberingMode ?? "auto";
  const providedNumber = (body.employeeNumber as string | undefined)?.trim();

  let employeeNumber: string;
  if (numberingMode === "manual") {
    if (!providedNumber) { res.status(400).json({ error: "employeeNumber is required in manual numbering mode" }); return; }
    const err = await validateManualEmployeeNumber(workspaceId, providedNumber);
    if (err) { res.status(409).json({ error: err }); return; }
    employeeNumber = providedNumber;
    // Sync counter so next auto number won't collide
    if (/^\d+$/.test(providedNumber)) {
      const n = parseInt(providedNumber, 10);
      await db.execute(sql`INSERT INTO hr_workspace_counters (workspace_id, counter_name, current_value) VALUES (${workspaceId}, 'employee_number', ${n}) ON CONFLICT (workspace_id, counter_name) DO UPDATE SET current_value = GREATEST(hr_workspace_counters.current_value, ${n})`);
    }
  } else if (numberingMode === "hybrid" && providedNumber) {
    const err = await validateManualEmployeeNumber(workspaceId, providedNumber);
    if (err) { res.status(409).json({ error: err }); return; }
    employeeNumber = providedNumber;
    if (/^\d+$/.test(providedNumber)) {
      const n = parseInt(providedNumber, 10);
      await db.execute(sql`INSERT INTO hr_workspace_counters (workspace_id, counter_name, current_value) VALUES (${workspaceId}, 'employee_number', ${n}) ON CONFLICT (workspace_id, counter_name) DO UPDATE SET current_value = GREATEST(hr_workspace_counters.current_value, ${n})`);
    }
  } else {
    // auto or hybrid without a provided number → generate
    employeeNumber = await generateEmployeeNumber(workspaceId);
  }

  // If userId is provided, validate it exists in the workspace
  if (userId) {
    const [user] = await db.select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.id, userId), eq(usersTable.workspaceId, workspaceId)));
    if (!user) { res.status(404).json({ error: "User not found in workspace" }); return; }

    const [existing] = await db.select({ id: employeesTable.id })
      .from(employeesTable)
      .where(eq(employeesTable.userId, userId));
    if (existing) { res.status(409).json({ error: "Employee profile already exists for this user" }); return; }
  }

  const orgCheck = await validateEmployeeOrgLinking(workspaceId, null, {
    status: status ?? "active",
    orgUnitId: orgUnitId ?? null,
    directManagerId: directManagerId ?? null,
  });
  if (!orgCheck.ok) {
    res.status(orgCheck.status).json({ error: orgCheck.error, code: orgCheck.code });
    return;
  }

  const [emp] = await db.insert(employeesTable).values({
    workspaceId,
    userId: userId ?? null,
    fullName: fullName.trim(),
    firstName: firstName?.trim() ?? null,
    lastName: lastName?.trim() ?? null,
    email: email?.trim() ?? null,
    phoneNumber: phoneNumber?.trim() ?? null,
    employeeNumber,
    avatarUrl: avatarUrl ?? null,
    status: status ?? "active",
    nationality: nationality ?? null,
    gender: gender ?? null,
    dateOfBirth: dateOfBirth ?? null,
    maritalStatus: maritalStatus ?? null,
    address: address ?? null,
    nationalId: nationalId ?? null,
    passportNumber: passportNumber ?? null,
    employmentType: employmentType ?? "full_time",
    hireDate: hireDate ?? null,
    endDate: endDate ?? null,
    probationEndDate: probationEndDate ?? null,
    orgUnitId: orgUnitId ?? null,
    jobTitleId: jobTitleId ?? null,
    jobGradeId: jobGradeId ?? null,
    position: position?.trim() ?? null,
    directManagerId: directManagerId ?? null,
    company: company?.trim() ?? null,
    branch: branch?.trim() ?? null,
    location: location?.trim() ?? null,
    emergencyContactName: emergencyContactName ?? null,
    emergencyContactPhone: emergencyContactPhone ?? null,
    emergencyContactRelation: emergencyContactRelation ?? null,
    notes: notes ?? null,
  }).returning();

  // Log creation
  await logActivity(workspaceId, emp!.id, "employee_created", `Employee profile created for ${fullName}`, req.userId);

  res.status(201).json(emp);
});

// ── PATCH /hr/employees/:id ────────────────────────────────────────────────────

router.patch("/hr/employees/:id", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select()
    .from(employeesTable)
    .where(and(eq(employeesTable.id, id), eq(employeesTable.workspaceId, workspaceId)));
  if (!existing) { res.status(404).json({ error: "Employee not found" }); return; }

  const allowed = [
    "fullName", "firstName", "lastName", "email", "phoneNumber", "employeeNumber",
    "avatarUrl", "status", "nationality", "gender", "dateOfBirth", "maritalStatus",
    "address", "nationalId", "passportNumber", "employmentType", "hireDate",
    "endDate", "probationEndDate", "orgUnitId", "jobTitleId", "jobGradeId",
    "position", "directManagerId", "company", "branch", "location",
    "emergencyContactName", "emergencyContactPhone", "emergencyContactRelation",
    "leaveBalances", "onboardingData", "notes",
  ];

  const updates: Record<string, unknown> = {};
  const before: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in req.body) {
      updates[key] = req.body[key];
      before[key] = (existing as Record<string, unknown>)[key];
    }
  }

  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No fields to update" }); return; }

  const nextStatus = (updates.status !== undefined ? updates.status : existing.status) as string;
  const nextOrgUnitId = (updates.orgUnitId !== undefined ? updates.orgUnitId : existing.orgUnitId) as number | null;
  const nextManagerId = (updates.directManagerId !== undefined ? updates.directManagerId : existing.directManagerId) as number | null;
  const nextEmploymentType = (updates.employmentType !== undefined ? updates.employmentType : existing.employmentType) as string | null;
  const nextJobTitleId = (updates.jobTitleId !== undefined ? updates.jobTitleId : existing.jobTitleId) as number | null;

  const orgCheck = await validateEmployeeOrgLinking(workspaceId, id, {
    status: nextStatus,
    orgUnitId: nextOrgUnitId,
    directManagerId: nextManagerId,
  });
  if (!orgCheck.ok) {
    res.status(orgCheck.status).json({ error: orgCheck.error, code: orgCheck.code });
    return;
  }

  const govCheck = await validateWorkforceGovernance(workspaceId, id, {
    status: nextStatus,
    orgUnitId: nextOrgUnitId,
    directManagerId: nextManagerId,
    employmentType: nextEmploymentType,
    jobTitleId: nextJobTitleId,
  });
  if (!govCheck.ok) {
    res.status(govCheck.status).json({ error: govCheck.error, code: govCheck.code });
    return;
  }

  const [updated] = await db.update(employeesTable)
    .set(updates as any)
    .where(eq(employeesTable.id, id))
    .returning();

  if ("status" in updates) {
    void maybeDeactivateLinkedUserOnTermination({
      workspaceId,
      employeeId: id,
      newStatus: String(updates.status),
      previousStatus: existing.status,
      actorUserId: req.userId,
    }).catch(() => undefined);
  }

  await logActivity(workspaceId, id, "profile_updated", "Employee profile updated", req.userId, null, { before, after: updates });

  void appendTimelineEvent({
    workspaceId,
    employeeId: id,
    eventCategory: "profile",
    eventType: "profile_updated",
    title: "Profile updated",
    actorUserId: req.userId,
    metadata: { fields: Object.keys(updates) },
  }).catch(() => undefined);

  if ("directManagerId" in updates || "orgUnitId" in updates) {
    void syncLegacyUserFieldsFromEmployee(workspaceId, id).catch(() => undefined);
  }

  res.json(updated);
});

// ── DELETE /hr/employees/:id ───────────────────────────────────────────────────

router.delete("/hr/employees/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  await db.delete(employeesTable)
    .where(and(eq(employeesTable.id, id), eq(employeesTable.workspaceId, workspaceId)));

  res.status(204).end();
});

// ── ORG UNITS ─────────────────────────────────────────────────────────────────

router.get("/hr/org-units", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.json([]); return; }
  try {
    const rows = await db.select().from(hrOrgUnitsTable)
      .where(and(eq(hrOrgUnitsTable.workspaceId, req.workspaceId), eq(hrOrgUnitsTable.isActive, true)))
      .orderBy(asc(hrOrgUnitsTable.type), asc(hrOrgUnitsTable.displayOrder), asc(hrOrgUnitsTable.name));
    res.json(rows);
  } catch (e) {
    if (handleWorkforceRouteError(res, e, { route: "GET /hr/org-units" })) return;
    throw e;
  }
});

router.get("/hr/org-units/tree", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.json([]); return; }
  try {
    const rows = await db.select().from(hrOrgUnitsTable)
      .where(and(eq(hrOrgUnitsTable.workspaceId, req.workspaceId), eq(hrOrgUnitsTable.isActive, true)));
    res.json(buildOrgTree(rows));
  } catch (e) {
    if (handleWorkforceRouteError(res, e, { route: "GET /hr/org-units/tree" })) return;
    throw e;
  }
});

router.post("/hr/org-units", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(400).json({ error: "No workspace" }); return; }
  const { name, nameAr, type, parentId, color, displayOrder, managerEmployeeId, _computedCode } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }

  const normalizedType = normalizeOrgUnitType(type ?? "department");
  if (!isValidOrgUnitType(normalizedType)) {
    res.status(400).json({ error: "Invalid org unit type", allowed: ["company", "branch", "division", "department", "team", "unit"] });
    return;
  }

  try {
    const pid = parentId ? Number(parentId) : null;
    if (pid != null) {
      const parent = await getOrgUnitById(req.workspaceId, pid);
      if (!parent) { res.status(400).json({ error: "Parent org unit not found" }); return; }
      const parentCheck = validateOrgParentType(normalizedType, parent.type);
      if (!parentCheck.ok) { res.status(400).json({ error: parentCheck.error }); return; }
    } else {
      const rootCheck = validateOrgParentType(normalizedType, null);
      if (!rootCheck.ok) { res.status(400).json({ error: rootCheck.error }); return; }
    }

    if (managerEmployeeId != null) {
      const [mgr] = await db.select({ id: employeesTable.id })
        .from(employeesTable)
        .where(and(eq(employeesTable.id, Number(managerEmployeeId)), eq(employeesTable.workspaceId, req.workspaceId)));
      if (!mgr) { res.status(400).json({ error: "managerEmployeeId must reference a workspace employee" }); return; }
    }

    const code = String(_computedCode || toCode(name) || "unit") || null;
    const [row] = await db.insert(hrOrgUnitsTable).values({
      workspaceId: req.workspaceId,
      name: name.trim(), nameAr: nameAr?.trim() ?? null,
      type: normalizedType, parentId: pid,
      managerEmployeeId: managerEmployeeId ? Number(managerEmployeeId) : null,
      code, color: color ?? "#6366f1",
      displayOrder: displayOrder ?? 0,
    }).returning();
    res.status(201).json(row);
  } catch (e) {
    if (handleWorkforceRouteError(res, e, { route: "POST /hr/org-units" })) return;
    throw e;
  }
});

router.patch("/hr/org-units/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(400).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const { name, nameAr, type, parentId, code, color, displayOrder, isActive, managerEmployeeId } = req.body;
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name.trim();
  if (nameAr !== undefined) updates.nameAr = nameAr;
  if (type !== undefined) {
    const normalizedType = normalizeOrgUnitType(type);
    if (!isValidOrgUnitType(normalizedType)) {
      res.status(400).json({ error: "Invalid org unit type" }); return;
    }
    updates.type = normalizedType;
  }
  if (parentId !== undefined) updates.parentId = parentId;
  if (code !== undefined) updates.code = code;
  if (color !== undefined) updates.color = color;
  if (displayOrder !== undefined) updates.displayOrder = displayOrder;
  if (isActive !== undefined) updates.isActive = isActive;
  if (managerEmployeeId !== undefined) updates.managerEmployeeId = managerEmployeeId ? Number(managerEmployeeId) : null;
  if (!Object.keys(updates).length) { res.status(400).json({ error: "No fields" }); return; }

  try {
    const [existing] = await db.select().from(hrOrgUnitsTable)
      .where(and(eq(hrOrgUnitsTable.id, id), eq(hrOrgUnitsTable.workspaceId, req.workspaceId)));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    if (managerEmployeeId != null) {
      const [mgr] = await db.select({ id: employeesTable.id })
        .from(employeesTable)
        .where(and(eq(employeesTable.id, Number(managerEmployeeId)), eq(employeesTable.workspaceId, req.workspaceId)));
      if (!mgr) { res.status(400).json({ error: "managerEmployeeId must reference a workspace employee" }); return; }
    }

    const units = await loadWorkspaceOrgUnits(req.workspaceId);
    if (parentId !== undefined) {
      const newParent = parentId === null || parentId === "" ? null : Number(parentId);
      if (newParent != null && wouldCreateOrgCycle(id, newParent, units)) {
        res.status(400).json({ error: "Invalid parent: would create hierarchy cycle" });
        return;
      }
      updates.parentId = newParent;
    }

    const nextType = (updates.type as string | undefined) ?? existing.type;
    const nextParentId = updates.parentId !== undefined
      ? (updates.parentId as number | null)
      : existing.parentId;
    if (nextParentId != null) {
      const parent = units.find((u) => u.id === nextParentId);
      if (!parent) { res.status(400).json({ error: "Parent org unit not found" }); return; }
      const parentCheck = validateOrgParentType(nextType, parent.type);
      if (!parentCheck.ok) { res.status(400).json({ error: parentCheck.error }); return; }
    } else {
      const rootCheck = validateOrgParentType(nextType, null);
      if (!rootCheck.ok) { res.status(400).json({ error: rootCheck.error }); return; }
    }

    const [updated] = await db.update(hrOrgUnitsTable).set(updates as any)
      .where(and(eq(hrOrgUnitsTable.id, id), eq(hrOrgUnitsTable.workspaceId, req.workspaceId))).returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json(updated);
  } catch (e) {
    if (handleWorkforceRouteError(res, e, { route: "PATCH /hr/org-units/:id", orgUnitId: id })) return;
    throw e;
  }
});

router.get("/hr/org-units/:id/ancestors", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id || !req.workspaceId) { res.status(400).json({ error: "Invalid" }); return; }
  try {
    const ancestors = await getOrgUnitAncestors(req.workspaceId, id);
    res.json(ancestors);
  } catch (e) {
    if (handleWorkforceRouteError(res, e, { route: "GET /hr/org-units/:id/ancestors", orgUnitId: id })) return;
    throw e;
  }
});

router.get("/hr/org-units/:id/descendants", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id || !req.workspaceId) { res.status(400).json({ error: "Invalid" }); return; }
  try {
    const ids = await getOrgUnitDescendantIds(req.workspaceId, id);
    res.json({ orgUnitId: id, descendantIds: ids });
  } catch (e) {
    if (handleWorkforceRouteError(res, e, { route: "GET /hr/org-units/:id/descendants", orgUnitId: id })) return;
    throw e;
  }
});

router.get("/hr/org-units/:id/employees", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id || !req.workspaceId) { res.json([]); return; }
  try {
    const rows = await getEmployeesInOrgSubtree(req.workspaceId, id);
    res.json(rows);
  } catch (e) {
    if (handleWorkforceRouteError(res, e, { route: "GET /hr/org-units/:id/employees", orgUnitId: id })) return;
    throw e;
  }
});

router.get("/hr/employees/:id/reporting-chain", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id || !req.workspaceId) { res.status(400).json({ error: "Invalid" }); return; }
  try {
    const chain = await getFullReportingChain(req.workspaceId, id);
    res.json(chain);
  } catch (e) {
    if (e instanceof ManagerCycleError) {
      res.status(400).json({ error: e.message, code: "MANAGER_CYCLE" });
      return;
    }
    if (handleWorkforceRouteError(res, e, { route: "GET /hr/employees/:id/reporting-chain", employeeId: id })) return;
    throw e;
  }
});

router.delete("/hr/org-units/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(400).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(hrOrgUnitsTable).where(and(eq(hrOrgUnitsTable.id, id), eq(hrOrgUnitsTable.workspaceId, req.workspaceId)));
  res.status(204).end();
});

// ── JOB GRADES ────────────────────────────────────────────────────────────────

router.get("/hr/job-grades", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.json([]); return; }
  const rows = await db.select().from(hrJobGradesTable)
    .where(eq(hrJobGradesTable.workspaceId, req.workspaceId))
    .orderBy(asc(hrJobGradesTable.level), asc(hrJobGradesTable.displayOrder));
  res.json(rows);
});

router.post("/hr/job-grades", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(400).json({ error: "No workspace" }); return; }
  const { name, nameAr, level, description, displayOrder, _computedCode } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }
  const code = String(_computedCode || toCode(name) || 'grade') || null;
  const [row] = await db.insert(hrJobGradesTable).values({
    workspaceId: req.workspaceId, name: name.trim(), nameAr: nameAr?.trim() ?? null,
    code, level: level ?? null, description: description ?? null,
    displayOrder: displayOrder ?? 0,
  }).returning();
  res.status(201).json(row);
});

router.patch("/hr/job-grades/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(400).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const { name, nameAr, code, level, description, displayOrder } = req.body;
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (nameAr !== undefined) updates.nameAr = nameAr;
  if (code !== undefined) updates.code = code;
  if (level !== undefined) updates.level = level;
  if (description !== undefined) updates.description = description;
  if (displayOrder !== undefined) updates.displayOrder = displayOrder;
  if (!Object.keys(updates).length) { res.status(400).json({ error: "No fields" }); return; }
  const [updated] = await db.update(hrJobGradesTable).set(updates as any)
    .where(and(eq(hrJobGradesTable.id, id), eq(hrJobGradesTable.workspaceId, req.workspaceId))).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

router.delete("/hr/job-grades/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(400).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(hrJobGradesTable).where(and(eq(hrJobGradesTable.id, id), eq(hrJobGradesTable.workspaceId, req.workspaceId)));
  res.status(204).end();
});

// ── JOB TITLES ────────────────────────────────────────────────────────────────

router.get("/hr/job-titles", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.json([]); return; }
  const rows = await db.select({
    id: hrJobTitlesTable.id, name: hrJobTitlesTable.name, nameAr: hrJobTitlesTable.nameAr,
    code: hrJobTitlesTable.code, gradeId: hrJobTitlesTable.gradeId,
    gradeName: hrJobGradesTable.name, gradeCode: hrJobGradesTable.code,
    description: hrJobTitlesTable.description, displayOrder: hrJobTitlesTable.displayOrder,
  })
    .from(hrJobTitlesTable)
    .leftJoin(hrJobGradesTable, eq(hrJobTitlesTable.gradeId, hrJobGradesTable.id))
    .where(eq(hrJobTitlesTable.workspaceId, req.workspaceId))
    .orderBy(asc(hrJobTitlesTable.displayOrder), asc(hrJobTitlesTable.name));
  res.json(rows);
});

router.post("/hr/job-titles", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(400).json({ error: "No workspace" }); return; }
  const { name, nameAr, gradeId, description, displayOrder, _computedCode } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }
  const code = String(_computedCode || toCode(name) || 'title') || null;
  const [row] = await db.insert(hrJobTitlesTable).values({
    workspaceId: req.workspaceId, name: name.trim(), nameAr: nameAr?.trim() ?? null,
    code, gradeId: gradeId ? Number(gradeId) : null,
    description: description ?? null, displayOrder: displayOrder ?? 0,
  }).returning();
  res.status(201).json(row);
});

router.patch("/hr/job-titles/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(400).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const { name, nameAr, code, gradeId, description, displayOrder } = req.body;
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (nameAr !== undefined) updates.nameAr = nameAr;
  if (code !== undefined) updates.code = code;
  if (gradeId !== undefined) updates.gradeId = gradeId;
  if (description !== undefined) updates.description = description;
  if (displayOrder !== undefined) updates.displayOrder = displayOrder;
  if (!Object.keys(updates).length) { res.status(400).json({ error: "No fields" }); return; }
  const [updated] = await db.update(hrJobTitlesTable).set(updates as any)
    .where(and(eq(hrJobTitlesTable.id, id), eq(hrJobTitlesTable.workspaceId, req.workspaceId))).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

router.delete("/hr/job-titles/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(400).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(hrJobTitlesTable).where(and(eq(hrJobTitlesTable.id, id), eq(hrJobTitlesTable.workspaceId, req.workspaceId)));
  res.status(204).end();
});

// ── CUSTOM FIELD DEFINITIONS ───────────────────────────────────────────────────

router.get("/hr/custom-fields", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.json([]); return; }
  const { section } = req.query as Record<string, string | undefined>;
  const conditions = [eq(hrCustomFieldDefsTable.workspaceId, req.workspaceId), eq(hrCustomFieldDefsTable.isActive, true)];
  if (section) conditions.push(eq(hrCustomFieldDefsTable.section, section));
  const rows = await db.select().from(hrCustomFieldDefsTable)
    .where(and(...conditions))
    .orderBy(asc(hrCustomFieldDefsTable.section), asc(hrCustomFieldDefsTable.displayOrder));
  res.json(rows);
});

router.post("/hr/custom-fields", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(400).json({ error: "No workspace" }); return; }
  const { name, label, labelAr, section, fieldType, options, linkedConfig, required, displayOrder } = req.body;
  if (!name?.trim() || !label?.trim()) { res.status(400).json({ error: "name and label are required" }); return; }
  const [row] = await db.insert(hrCustomFieldDefsTable).values({
    workspaceId: req.workspaceId, name: name.trim(), label: label.trim(),
    labelAr: labelAr?.trim() ?? null, section: section ?? "custom",
    fieldType: fieldType ?? "text", options: options ?? null,
    linkedConfig: linkedConfig ?? null, required: required ?? false,
    displayOrder: displayOrder ?? 0,
  }).returning();
  res.status(201).json(row);
});

router.patch("/hr/custom-fields/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(400).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const { label, labelAr, section, fieldType, options, linkedConfig, required, displayOrder, isActive } = req.body;
  const updates: Record<string, unknown> = {};
  if (label !== undefined) updates.label = label;
  if (labelAr !== undefined) updates.labelAr = labelAr;
  if (section !== undefined) updates.section = section;
  if (fieldType !== undefined) updates.fieldType = fieldType;
  if (options !== undefined) updates.options = options;
  if (linkedConfig !== undefined) updates.linkedConfig = linkedConfig;
  if (required !== undefined) updates.required = required;
  if (displayOrder !== undefined) updates.displayOrder = displayOrder;
  if (isActive !== undefined) updates.isActive = isActive;
  if (!Object.keys(updates).length) { res.status(400).json({ error: "No fields" }); return; }
  const [updated] = await db.update(hrCustomFieldDefsTable).set(updates as any)
    .where(and(eq(hrCustomFieldDefsTable.id, id), eq(hrCustomFieldDefsTable.workspaceId, req.workspaceId))).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

router.delete("/hr/custom-fields/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(400).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(hrCustomFieldDefsTable).where(and(eq(hrCustomFieldDefsTable.id, id), eq(hrCustomFieldDefsTable.workspaceId, req.workspaceId)));
  res.status(204).end();
});

// ── CUSTOM FIELD VALUES (per employee) ────────────────────────────────────────

router.get("/hr/employees/:id/custom-fields", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id || !req.workspaceId) { res.json([]); return; }

  // Get all active field defs for this workspace
  const defs = await db.select().from(hrCustomFieldDefsTable)
    .where(and(eq(hrCustomFieldDefsTable.workspaceId, req.workspaceId), eq(hrCustomFieldDefsTable.isActive, true)))
    .orderBy(asc(hrCustomFieldDefsTable.section), asc(hrCustomFieldDefsTable.displayOrder));

  // Get existing values
  const vals = await db.select().from(hrCustomFieldValuesTable).where(eq(hrCustomFieldValuesTable.employeeId, id));
  const valMap = new Map(vals.map(v => [v.fieldDefId, v.value]));

  // Merge defs with values
  const result = defs.map(d => ({ ...d, value: valMap.get(d.id) ?? null }));
  res.json(result);
});

router.put("/hr/employees/:id/custom-fields/:fieldId", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const empId = parseId(req.params.id);
  const fieldId = parseId(req.params.fieldId);
  if (!empId || !fieldId || !req.workspaceId) { res.status(400).json({ error: "Invalid id" }); return; }

  const { value } = req.body;

  await db.insert(hrCustomFieldValuesTable)
    .values({ employeeId: empId, fieldDefId: fieldId, value: value ?? null })
    .onConflictDoUpdate({ target: [hrCustomFieldValuesTable.employeeId, hrCustomFieldValuesTable.fieldDefId], set: { value: value ?? null, updatedAt: new Date() } });

  await logActivity(req.workspaceId, empId, "custom_field_updated", "Custom field value updated", req.userId);
  res.json({ ok: true });
});

// ── CONTRACTS ─────────────────────────────────────────────────────────────────

router.get("/hr/employees/:id/contracts", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id || !req.workspaceId) { res.json([]); return; }
  const rows = await db.select().from(hrEmployeeContractsTable)
    .where(and(eq(hrEmployeeContractsTable.employeeId, id), eq(hrEmployeeContractsTable.workspaceId, req.workspaceId)))
    .orderBy(desc(hrEmployeeContractsTable.createdAt));
  res.json(rows);
});

router.post("/hr/employees/:id/contracts", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const empId = parseId(req.params.id);
  if (!empId || !req.workspaceId) { res.status(400).json({ error: "Invalid" }); return; }
  const { contractType, startDate, endDate, status, salary, currency, notes, attachments } = req.body;
  const [row] = await db.insert(hrEmployeeContractsTable).values({
    workspaceId: req.workspaceId, employeeId: empId,
    contractType: contractType ?? "permanent", startDate: startDate ?? null,
    endDate: endDate ?? null, status: status ?? "active",
    salary: salary ?? null, currency: currency ?? "SAR",
    notes: notes ?? null, attachments: attachments ?? null,
    createdBy: req.userId ?? null,
  }).returning();
  await logActivity(req.workspaceId, empId, "contract_added", "Contract added", req.userId);
  if (req.userId && attachments) {
    void bridgeContractAttachments({
      workspaceId: req.workspaceId,
      userId: req.userId,
      employeeId: empId,
      contractId: row!.id,
      attachments,
    });
  }
  res.status(201).json(row);
});

router.patch("/hr/employees/:id/contracts/:cid", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const empId = parseId(req.params.id);
  const cid = parseId(req.params.cid);
  if (!empId || !cid || !req.workspaceId) { res.status(400).json({ error: "Invalid" }); return; }
  const allowed = ["contractType", "startDate", "endDate", "status", "salary", "currency", "notes", "attachments"];
  const updates: Record<string, unknown> = {};
  for (const k of allowed) { if (k in req.body) updates[k] = req.body[k]; }
  if (!Object.keys(updates).length) { res.status(400).json({ error: "No fields" }); return; }
  const [updated] = await db.update(hrEmployeeContractsTable).set(updates as any)
    .where(and(eq(hrEmployeeContractsTable.id, cid), eq(hrEmployeeContractsTable.employeeId, empId))).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

router.delete("/hr/employees/:id/contracts/:cid", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const empId = parseId(req.params.id);
  const cid = parseId(req.params.cid);
  if (!empId || !cid) { res.status(400).json({ error: "Invalid" }); return; }
  await db.delete(hrEmployeeContractsTable).where(and(eq(hrEmployeeContractsTable.id, cid), eq(hrEmployeeContractsTable.employeeId, empId)));
  res.status(204).end();
});

// ── DOCUMENTS ─────────────────────────────────────────────────────────────────

router.get("/hr/employees/:id/documents", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id || !req.workspaceId) { res.json([]); return; }
  const rows = await db.select().from(hrEmployeeDocumentsTable)
    .where(and(eq(hrEmployeeDocumentsTable.employeeId, id), eq(hrEmployeeDocumentsTable.workspaceId, req.workspaceId)))
    .orderBy(desc(hrEmployeeDocumentsTable.createdAt));
  res.json(rows);
});

router.post("/hr/employees/:id/documents", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const empId = parseId(req.params.id);
  if (!empId || !req.workspaceId) { res.status(400).json({ error: "Invalid" }); return; }
  const { documentType, name, documentNumber, issueDate, expiryDate, objectPath, fileName, fileSize, notes, mimeType, checksum, storageKey, categoryCode, isSigned } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }
  try {
    const [row] = await db.insert(hrEmployeeDocumentsTable).values({
      workspaceId: req.workspaceId, employeeId: empId,
      documentType: documentType ?? "other", name: name.trim(),
      documentNumber: documentNumber ?? null, issueDate: issueDate ?? null,
      expiryDate: expiryDate ?? null, objectPath: objectPath ?? null,
      fileName: fileName ?? null, fileSize: fileSize ?? null,
      mimeType: mimeType ?? null, checksum: checksum ?? null, storageKey: storageKey ?? null,
      categoryCode: categoryCode ?? documentType ?? null,
      isSigned: isSigned ?? false,
      signedAt: isSigned ? new Date() : null,
      notes: notes ?? null, createdBy: req.userId ?? null,
    }).returning();
    await logActivity(req.workspaceId, empId, "document_added", `Document "${name}" added`, req.userId);
    void onEmployeeDocumentUploaded({
      workspaceId: req.workspaceId,
      employeeId: empId,
      documentId: row!.id,
      name: name.trim(),
      documentType: documentType ?? "other",
      categoryCode: categoryCode ?? documentType ?? null,
      isSigned: isSigned ?? false,
      actorUserId: req.userId,
    }).catch(() => undefined);
    const pathForBridge = objectPath ?? storageKey ?? null;
    if (req.userId && pathForBridge) {
      void bridgeHrEmployeeDocument({
        workspaceId: req.workspaceId,
        userId: req.userId,
        employeeId: empId,
        name: name.trim(),
        objectPath: pathForBridge,
        fileName: fileName ?? null,
        fileSize: fileSize ?? null,
      });
    }
    res.status(201).json(row);
  } catch (e) {
    if (handleWorkforceRouteError(res, e, { route: "POST /hr/employees/:id/documents", employeeId: empId })) return;
    throw e;
  }
});

router.post(
  "/hr/employees/:id/documents/upload",
  requireAuth,
  requirePermission("hr.manage"),
  parseHrDocumentUpload,
  async (req: AuthRequest, res): Promise<void> => {
    const empId = parseId(req.params.id);
    if (!empId || !req.workspaceId) { res.status(400).json({ error: "Invalid" }); return; }
    const upload = req.hrDocumentUpload;
    if (!upload) { res.status(400).json({ error: "File is required" }); return; }

    const documentType = typeof req.body?.documentType === "string" ? req.body.documentType : "other";
    const categoryCode = typeof req.body?.categoryCode === "string" ? req.body.categoryCode : documentType;
    const isSigned = req.body?.isSigned === true || req.body?.isSigned === "true";
    const name = typeof req.body?.name === "string" && req.body.name.trim()
      ? req.body.name.trim()
      : upload.originalFileName;

    try {
      const ext = upload.originalFileName.includes(".")
        ? upload.originalFileName.split(".").pop()!
        : "pdf";
      const storageKey = buildEmployeeFileStorageKey(req.workspaceId, empId, ext);
      const { checksum } = await saveEmployeeFile(storageKey, upload.buffer);
      const objectPath = objectPathFromStorageKey(storageKey);

      const [row] = await db.insert(hrEmployeeDocumentsTable).values({
        workspaceId: req.workspaceId,
        employeeId: empId,
        documentType,
        categoryCode,
        isSigned,
        signedAt: isSigned ? new Date() : null,
        name,
        objectPath,
        storageKey,
        fileName: upload.originalFileName,
        fileSize: upload.buffer.length,
        mimeType: upload.mimeType,
        checksum,
        createdBy: req.userId ?? null,
      }).returning();

      await logActivity(req.workspaceId, empId, "document_uploaded", `Document "${name}" uploaded`, req.userId);
      void onEmployeeDocumentUploaded({
        workspaceId: req.workspaceId,
        employeeId: empId,
        documentId: row!.id,
        name,
        documentType,
        categoryCode,
        isSigned,
        actorUserId: req.userId,
      }).catch(() => undefined);
      if (req.userId) {
        void bridgeHrEmployeeDocument({
          workspaceId: req.workspaceId,
          userId: req.userId,
          employeeId: empId,
          name,
          objectPath,
          fileName: upload.originalFileName,
          fileSize: upload.buffer.length,
        });
      }
      res.status(201).json(row);
    } catch (e) {
      if (handleWorkforceRouteError(res, e, { route: "POST /hr/employees/:id/documents/upload", employeeId: empId })) return;
      throw e;
    }
  },
);

router.delete("/hr/employees/:id/documents/:did", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const empId = parseId(req.params.id);
  const did = parseId(req.params.did);
  if (!empId || !did) { res.status(400).json({ error: "Invalid" }); return; }
  await db.delete(hrEmployeeDocumentsTable).where(and(eq(hrEmployeeDocumentsTable.id, did), eq(hrEmployeeDocumentsTable.employeeId, empId)));
  res.status(204).end();
});

// ── LEAVES ────────────────────────────────────────────────────────────────────

router.get("/hr/employees/:id/leaves", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id || !req.workspaceId) { res.json([]); return; }
  const rows = await db.select().from(hrEmployeeLeavesTable)
    .where(and(eq(hrEmployeeLeavesTable.employeeId, id), eq(hrEmployeeLeavesTable.workspaceId, req.workspaceId)))
    .orderBy(desc(hrEmployeeLeavesTable.startDate));
  res.json(rows);
});

router.post("/hr/employees/:id/leaves", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  if (!(await assertLegacyLeaveWriteAllowed(req, res))) return;
  const empId = parseId(req.params.id);
  if (!empId || !req.workspaceId) { res.status(400).json({ error: "Invalid" }); return; }
  const { leaveType, startDate, endDate, daysCount, status, reason, notes } = req.body;
  if (!startDate || !endDate) { res.status(400).json({ error: "startDate and endDate are required" }); return; }
  const [row] = await db.insert(hrEmployeeLeavesTable).values({
    workspaceId: req.workspaceId, employeeId: empId,
    leaveType: leaveType ?? "annual", startDate, endDate,
    daysCount: daysCount ?? null, status: status ?? "pending",
    reason: reason ?? null, notes: notes ?? null,
    createdBy: req.userId ?? null,
  }).returning();
  await logActivity(req.workspaceId, empId, "leave_added", `${leaveType ?? "annual"} leave added`, req.userId);
  res.status(201).json(row);
});

router.patch("/hr/employees/:id/leaves/:lid", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  if (!(await assertLegacyLeaveWriteAllowed(req, res, "patch"))) return;
  const empId = parseId(req.params.id);
  const lid = parseId(req.params.lid);
  if (!empId || !lid || !req.workspaceId) { res.status(400).json({ error: "Invalid" }); return; }
  const { status, notes, daysCount, approvedBy, approvedAt } = req.body;
  const updates: Record<string, unknown> = {};
  if (status !== undefined) updates.status = status;
  if (notes !== undefined) updates.notes = notes;
  if (daysCount !== undefined) updates.daysCount = daysCount;
  if (approvedBy !== undefined) updates.approvedBy = approvedBy;
  if (approvedAt !== undefined) updates.approvedAt = approvedAt;
  if (!Object.keys(updates).length) { res.status(400).json({ error: "No fields" }); return; }
  const [updated] = await db.update(hrEmployeeLeavesTable).set(updates as any)
    .where(and(eq(hrEmployeeLeavesTable.id, lid), eq(hrEmployeeLeavesTable.employeeId, empId))).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

// ── POSITION HISTORY ──────────────────────────────────────────────────────────

router.get("/hr/employees/:id/position-history", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id || !req.workspaceId) { res.json([]); return; }
  void recordLegacyUsage({
    workspaceId: req.workspaceId,
    eventType: "route_hit",
    legacySurface: "hr_employee_position_history",
    sourcePath: "GET /hr/employees/:id/position-history",
    entityType: "employee",
    entityId: id,
  }).catch(() => undefined);
  const rows = await db.select().from(hrEmployeePositionHistoryTable)
    .where(and(eq(hrEmployeePositionHistoryTable.employeeId, id), eq(hrEmployeePositionHistoryTable.workspaceId, req.workspaceId)))
    .orderBy(desc(hrEmployeePositionHistoryTable.effectiveDate));
  res.json(rows);
});

router.post("/hr/employees/:id/position-history", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const empId = parseId(req.params.id);
  if (!empId || !req.workspaceId) { res.status(400).json({ error: "Invalid" }); return; }

  const writeCheck = await assertLegacyWriteAllowed(
    req.workspaceId,
    "hr_employee_position_history",
    "POST /hr/employees/:id/position-history",
  );
  if (!writeCheck.ok) {
    void recordLegacyUsage({
      workspaceId: req.workspaceId,
      eventType: "write_blocked",
      legacySurface: "hr_employee_position_history",
      sourcePath: "POST /hr/employees/:id/position-history",
      entityType: "employee",
      entityId: empId,
    }).catch(() => undefined);
    res.status(writeCheck.status).json({ error: writeCheck.error, code: writeCheck.code });
    return;
  }

  const { changeType, effectiveDate, fromTitle, toTitle, fromOrgUnitId, toOrgUnitId, fromGrade, toGrade, fromManagerId, toManagerId, notes } = req.body;
  if (!effectiveDate) { res.status(400).json({ error: "effectiveDate is required" }); return; }
  const [row] = await db.insert(hrEmployeePositionHistoryTable).values({
    workspaceId: req.workspaceId, employeeId: empId,
    changeType: changeType ?? "other", effectiveDate,
    fromTitle: fromTitle ?? null, toTitle: toTitle ?? null,
    fromOrgUnitId: fromOrgUnitId ?? null, toOrgUnitId: toOrgUnitId ?? null,
    fromGrade: fromGrade ?? null, toGrade: toGrade ?? null,
    fromManagerId: fromManagerId ?? null, toManagerId: toManagerId ?? null,
    notes: notes ?? null, createdBy: req.userId ?? null,
  }).returning();
  await logActivity(req.workspaceId, empId, "position_change", `${changeType ?? "Job movement"} recorded`, req.userId);
  void recordLegacyUsage({
    workspaceId: req.workspaceId,
    eventType: "adapter_write",
    legacySurface: "hr_employee_position_history",
    sourcePath: "POST /hr/employees/:id/position-history",
    entityType: "employee",
    entityId: empId,
  }).catch(() => undefined);
  res.status(201).json(row);
});

// ── NOTES ─────────────────────────────────────────────────────────────────────

router.get("/hr/employees/:id/notes", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id || !req.workspaceId) { res.json([]); return; }
  const rows = await db.select().from(hrEmployeeNotesTable)
    .where(and(eq(hrEmployeeNotesTable.employeeId, id), eq(hrEmployeeNotesTable.workspaceId, req.workspaceId)))
    .orderBy(desc(hrEmployeeNotesTable.createdAt));
  res.json(rows);
});

router.post("/hr/employees/:id/notes", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const empId = parseId(req.params.id);
  if (!empId || !req.workspaceId) { res.status(400).json({ error: "Invalid" }); return; }
  const { content, noteType, isConfidential, createdByName } = req.body;
  if (!content?.trim()) { res.status(400).json({ error: "content is required" }); return; }
  const [row] = await db.insert(hrEmployeeNotesTable).values({
    workspaceId: req.workspaceId, employeeId: empId,
    content: content.trim(), noteType: noteType ?? "general",
    isConfidential: isConfidential ?? false,
    createdBy: req.userId ?? null, createdByName: createdByName ?? null,
  }).returning();
  res.status(201).json(row);
});

router.delete("/hr/employees/:id/notes/:nid", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const empId = parseId(req.params.id);
  const nid = parseId(req.params.nid);
  if (!empId || !nid) { res.status(400).json({ error: "Invalid" }); return; }
  await db.delete(hrEmployeeNotesTable).where(and(eq(hrEmployeeNotesTable.id, nid), eq(hrEmployeeNotesTable.employeeId, empId)));
  res.status(204).end();
});

// ── ACTIVITY LOG ──────────────────────────────────────────────────────────────

router.get("/hr/employees/:id/activity", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id || !req.workspaceId) { res.json([]); return; }
  const rows = await db.select().from(hrEmployeeActivityTable)
    .where(and(eq(hrEmployeeActivityTable.employeeId, id), eq(hrEmployeeActivityTable.workspaceId, req.workspaceId)))
    .orderBy(desc(hrEmployeeActivityTable.createdAt))
    .limit(100);
  res.json(rows);
});

// ── HR SERVICE CATEGORIES ──────────────────────────────────────────────────────

router.get("/hr/categories", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.json([]); return; }
  const cats = await db.select().from(hrServiceCategoriesTable)
    .where(eq(hrServiceCategoriesTable.workspaceId, req.workspaceId))
    .orderBy(asc(hrServiceCategoriesTable.displayOrder), asc(hrServiceCategoriesTable.name));
  res.json(cats);
});

router.post("/hr/categories", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(400).json({ error: "No workspace" }); return; }
  const { name, nameAr, icon, color, displayOrder } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }
  const slug = toSlug(name);
  const [cat] = await db.insert(hrServiceCategoriesTable).values({
    workspaceId: req.workspaceId, name: name.trim(), nameAr: nameAr?.trim() ?? null,
    slug, icon: icon ?? "Tag", color: color ?? "#6366f1", displayOrder: displayOrder ?? 0,
  }).returning();
  res.status(201).json(cat);
});

router.patch("/hr/categories/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(400).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const { name, nameAr, icon, color, displayOrder } = req.body;
  const updates: Record<string, unknown> = {};
  if (name !== undefined) { updates.name = name.trim(); updates.slug = toSlug(name); }
  if (nameAr !== undefined) updates.nameAr = nameAr;
  if (icon !== undefined) updates.icon = icon;
  if (color !== undefined) updates.color = color;
  if (displayOrder !== undefined) updates.displayOrder = displayOrder;
  if (!Object.keys(updates).length) { res.status(400).json({ error: "No fields" }); return; }
  const [updated] = await db.update(hrServiceCategoriesTable).set(updates as any)
    .where(and(eq(hrServiceCategoriesTable.id, id), eq(hrServiceCategoriesTable.workspaceId, req.workspaceId))).returning();
  if (!updated) { res.status(404).json({ error: "Category not found" }); return; }
  res.json(updated);
});

router.delete("/hr/categories/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(400).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(hrServiceCategoriesTable)
    .where(and(eq(hrServiceCategoriesTable.id, id), eq(hrServiceCategoriesTable.workspaceId, req.workspaceId)));
  res.status(204).end();
});

// ── HR SERVICES ───────────────────────────────────────────────────────────────

router.get("/hr/services", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const { category, status } = req.query as Record<string, string | undefined>;
  const conditions = [eq(hrServicesTable.workspaceId, workspaceId)];
  const isAdmin = ["admin", "super_admin", "manager"].includes(req.userRole ?? "");
  if (!isAdmin) conditions.push(eq(hrServicesTable.status, "active"));
  if (status && isAdmin) conditions.push(eq(hrServicesTable.status, status));
  if (category) conditions.push(eq(hrServicesTable.category, category));
  const rows = await db.select({
      id: hrServicesTable.id, name: hrServicesTable.name, nameAr: hrServicesTable.nameAr,
      description: hrServicesTable.description, descriptionAr: hrServicesTable.descriptionAr,
      icon: hrServicesTable.icon, category: hrServicesTable.category,
      formId: hrServicesTable.formId, formName: formDefinitionsTable.name,
      workflowEvent: hrServicesTable.workflowEvent, status: hrServicesTable.status,
      permissions: hrServicesTable.permissions, settings: hrServicesTable.settings,
      displayOrder: hrServicesTable.displayOrder, createdAt: hrServicesTable.createdAt,
    })
    .from(hrServicesTable)
    .leftJoin(formDefinitionsTable, eq(hrServicesTable.formId, formDefinitionsTable.id))
    .where(and(...conditions))
    .orderBy(asc(hrServicesTable.displayOrder), asc(hrServicesTable.name));
  res.json(rows);
});

// ── GET /self-service/services - role-filtered HR services for the self-service portal ─────
router.get("/self-service/services", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  const userRole = req.userRole ?? "member";
  const isManagerAbove = ["manager", "admin", "super_admin"].includes(userRole);
  const isAdminAbove   = ["admin", "super_admin"].includes(userRole);

  const rows = await db.select({
    id: hrServicesTable.id,
    name: hrServicesTable.name,
    nameAr: hrServicesTable.nameAr,
    description: hrServicesTable.description,
    descriptionAr: hrServicesTable.descriptionAr,
    icon: hrServicesTable.icon,
    category: hrServicesTable.category,
    formId: hrServicesTable.formId,
    formName: formDefinitionsTable.name,
    workflowEvent: hrServicesTable.workflowEvent,
    permissions: hrServicesTable.permissions,
    settings: hrServicesTable.settings,
    displayOrder: hrServicesTable.displayOrder,
    createdAt: hrServicesTable.createdAt,
    updatedAt: hrServicesTable.updatedAt,
  })
  .from(hrServicesTable)
  .leftJoin(formDefinitionsTable, eq(hrServicesTable.formId, formDefinitionsTable.id))
  .where(and(
    eq(hrServicesTable.workspaceId, workspaceId),
    eq(hrServicesTable.status, "active"),
  ))
  .orderBy(asc(hrServicesTable.displayOrder), asc(hrServicesTable.name));

  // Filter by visibleTo stored inside permissions jsonb: "all"|"member"|"manager_above"|"admin_only"
  const filtered = rows.filter(row => {
    const perms = row.permissions as Record<string, unknown> | null;
    const visibleTo = (perms?.visibleTo as string | undefined) ?? "all";
    if (visibleTo === "member")        return userRole === "member";
    if (visibleTo === "manager_above") return isManagerAbove;
    if (visibleTo === "admin_only")    return isAdminAbove;
    return true; // "all" or unset
  });

  res.json(filtered);
});

router.get("/hr/services/:id", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.select().from(hrServicesTable)
    .where(and(eq(hrServicesTable.id, id), eq(hrServicesTable.workspaceId, workspaceId)));
  if (!row) { res.status(404).json({ error: "Service not found" }); return; }
  res.json(row);
});

async function upsertServiceEvents(eventBase: string, serviceName: string, serviceNameAr?: string | null) {
  const events = [
    { eventName: `${eventBase}.submitted`, description: `Fired when a ${serviceName} request is submitted`, descriptionAr: `يُطلق عند تقديم طلب ${serviceNameAr ?? serviceName}` },
    { eventName: `${eventBase}.status_changed`, description: `Fired when a ${serviceName} request status changes`, descriptionAr: `يُطلق عند تغيير حالة طلب ${serviceNameAr ?? serviceName}` },
    { eventName: `${eventBase}.completed`, description: `Fired when a ${serviceName} request is completed or approved`, descriptionAr: `يُطلق عند اكتمال طلب ${serviceNameAr ?? serviceName}` },
    { eventName: `${eventBase}.rejected`, description: `Fired when a ${serviceName} request is rejected`, descriptionAr: `يُطلق عند رفض طلب ${serviceNameAr ?? serviceName}` },
  ];
  for (const ev of events) {
    await db.insert(platformEventRegistryTable).values({
      eventName: ev.eventName, module: "hr", description: ev.description,
      descriptionAr: ev.descriptionAr,
      schema: { fields: [
        { name: "employeeId", label: "Employee", labelAr: "الموظف", type: "user", operators: ["eq","neq","in","not_in"] },
        { name: "requestId", label: "Request ID", labelAr: "رقم الطلب", type: "number", operators: ["eq","neq","gt","lt"] },
      ]},
    }).onConflictDoNothing();
  }
}

async function createDraftWorkflow(workspaceId: number, serviceName: string, serviceNameAr: string | null | undefined, triggerEvent: string, createdByUserId: number | null | undefined): Promise<number | null> {
  const key = `hr_${toSlug(serviceName)}_auto`;
  const [existing] = await db.select({ id: workflowDefinitionsTable.id }).from(workflowDefinitionsTable)
    .where(and(eq(workflowDefinitionsTable.workspaceId, workspaceId), eq(workflowDefinitionsTable.key, key)));
  if (existing) return existing.id;
  const [wf] = await db.insert(workflowDefinitionsTable).values({
    workspaceId, key, name: `${serviceName} - Auto Workflow`,
    nameAr: serviceNameAr ? `${serviceNameAr} - سير عمل تلقائي` : null,
    description: `Auto-generated workflow for ${serviceName} requests`,
    module: "hr", triggerEvent, isActive: false, conditions: [],
    steps: [
      { type: "notify", name: "Notify Manager", config: { channel: "in_app", recipientType: "manager", message: `New ${serviceName} request submitted` } },
      { type: "approval", name: "Manager Approval", config: { approverType: "manager", timeoutHours: 48 } },
      { type: "notify", name: "Notify Employee", config: { channel: "in_app", recipientType: "requester", message: `Your ${serviceName} request has been processed` } },
    ],
    createdBy: createdByUserId ?? null,
  }).returning({ id: workflowDefinitionsTable.id });
  return wf?.id ?? null;
}

router.post("/hr/services", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const { name, nameAr, description, descriptionAr, icon, category, formId, status, permissions, settings, displayOrder } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }
  const eventBase = `hr.${toSlug(name)}`;
  const workflowEvent = `${eventBase}.submitted`;
  const [svc] = await db.insert(hrServicesTable).values({
    workspaceId, name: name.trim(), nameAr: nameAr?.trim() ?? null,
    description: description ?? null, descriptionAr: descriptionAr ?? null,
    icon: icon ?? "FileText", category: category ?? "other",
    formId: formId ?? null, workflowEvent, status: status ?? "active",
    permissions: permissions ?? null, settings: settings ?? null,
    displayOrder: displayOrder ?? 0, createdByUserId: req.userId ?? null,
  }).returning();
  await upsertServiceEvents(eventBase, name, nameAr);
  await createDraftWorkflow(workspaceId, name, nameAr, workflowEvent, req.userId);
  res.status(201).json(svc);
});

router.patch("/hr/services/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const { name, nameAr, description, descriptionAr, icon, category, formId, status, permissions, settings, displayOrder } = req.body;
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name.trim();
  if (nameAr !== undefined) updates.nameAr = nameAr;
  if (description !== undefined) updates.description = description;
  if (descriptionAr !== undefined) updates.descriptionAr = descriptionAr;
  if (icon !== undefined) updates.icon = icon;
  if (category !== undefined) updates.category = category;
  if (formId !== undefined) updates.formId = formId;
  if (status !== undefined) updates.status = status;
  if (permissions !== undefined) updates.permissions = permissions;
  if (settings !== undefined) updates.settings = settings;
  if (displayOrder !== undefined) updates.displayOrder = displayOrder;
  if (!Object.keys(updates).length) { res.status(400).json({ error: "No fields" }); return; }
  const [updated] = await db.update(hrServicesTable).set(updates as any)
    .where(and(eq(hrServicesTable.id, id), eq(hrServicesTable.workspaceId, workspaceId))).returning();
  if (!updated) { res.status(404).json({ error: "Service not found" }); return; }
  res.json(updated);
});

router.delete("/hr/services/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(hrServicesTable).where(and(eq(hrServicesTable.id, id), eq(hrServicesTable.workspaceId, workspaceId)));
  res.status(204).end();
});

// ════════════════════════════════════════════════════════════════════════════
// HR FOUNDATION DATA LAYER
// All entities are workspace-scoped + fully dynamic (no hardcoded enums).
// ════════════════════════════════════════════════════════════════════════════

// ── Seed defaults for a workspace ───────────────────────────────────────────
router.post("/hr/foundation/seed", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  const defaultStatuses = [
    { code: "draft",      name: "Draft",      nameAr: "مسودة",          color: "#94a3b8", isDefault: false, isFinal: false, allowSelfService: false, displayOrder: 0 },
    { code: "active",     name: "Active",     nameAr: "نشط",            color: "#22c55e", isDefault: true,  isFinal: false, allowSelfService: false, displayOrder: 1 },
    { code: "on_leave",   name: "On Leave",   nameAr: "في إجازة",       color: "#f59e0b", isDefault: false, isFinal: false, allowSelfService: true,  displayOrder: 2 },
    { code: "suspended",  name: "Suspended",  nameAr: "موقوف",          color: "#f97316", isDefault: false, isFinal: false, allowSelfService: false, displayOrder: 3 },
    { code: "resigned",   name: "Resigned",   nameAr: "مستقيل",         color: "#ef4444", isDefault: false, isFinal: true,  allowSelfService: false, displayOrder: 4 },
    { code: "terminated", name: "Terminated", nameAr: "منتهية خدمته",   color: "#dc2626", isDefault: false, isFinal: true,  allowSelfService: false, displayOrder: 5 },
  ];
  for (const s of defaultStatuses) {
    await db.insert(hrEmployeeStatusesTable).values({ workspaceId, ...s }).onConflictDoNothing();
  }

  const defaultEmpTypes = [
    { code: "full_time",  name: "Full-Time",  nameAr: "دوام كامل",  color: "#6366f1", displayOrder: 0 },
    { code: "part_time",  name: "Part-Time",  nameAr: "دوام جزئي",  color: "#8b5cf6", displayOrder: 1 },
    { code: "contractor", name: "Contractor", nameAr: "متعاقد",     color: "#ec4899", displayOrder: 2 },
    { code: "intern",     name: "Intern",     nameAr: "متدرب",      color: "#14b8a6", displayOrder: 3 },
    { code: "temporary",  name: "Temporary",  nameAr: "مؤقت",       color: "#f59e0b", displayOrder: 4 },
  ];
  for (const t of defaultEmpTypes) {
    await db.insert(hrEmploymentTypesTable).values({ workspaceId, ...t }).onConflictDoNothing();
  }

  const defaultContractTypes = [
    { code: "annual",     name: "Annual",        nameAr: "سنوي",         color: "#6366f1", displayOrder: 0 },
    { code: "open_ended", name: "Open-Ended",    nameAr: "مفتوح المدة",  color: "#22c55e", displayOrder: 1 },
    { code: "project",    name: "Project-Based", nameAr: "مشروع",        color: "#f59e0b", displayOrder: 2 },
    { code: "training",   name: "Training",      nameAr: "تدريب",        color: "#14b8a6", displayOrder: 3 },
  ];
  for (const ct of defaultContractTypes) {
    await db.insert(hrContractTypesTable).values({ workspaceId, ...ct }).onConflictDoNothing();
  }

  const defaultDocTypes = [
    { code: "national_id",     name: "National ID",          nameAr: "هوية وطنية",    hasExpiry: true,  isRequired: true,  displayOrder: 0 },
    { code: "passport",        name: "Passport",             nameAr: "جواز سفر",      hasExpiry: true,  isRequired: false, displayOrder: 1 },
    { code: "iqama",           name: "Iqama",                nameAr: "إقامة",          hasExpiry: true,  isRequired: false, displayOrder: 2 },
    { code: "driving_license", name: "Driving License",      nameAr: "رخصة قيادة",    hasExpiry: true,  isRequired: false, displayOrder: 3 },
    { code: "certificate",     name: "Certificate",          nameAr: "شهادة",          hasExpiry: false, isRequired: false, displayOrder: 4 },
    { code: "contract",        name: "Employment Contract",  nameAr: "عقد عمل",       hasExpiry: false, isRequired: true,  displayOrder: 5 },
    { code: "other",           name: "Other",                nameAr: "أخرى",           hasExpiry: false, isRequired: false, displayOrder: 6 },
  ];
  for (const dt of defaultDocTypes) {
    await db.insert(hrDocumentTypesTable).values({ workspaceId, ...dt }).onConflictDoNothing();
  }

  const defaultLeavePolicies = [
    { code: "annual",    name: "Annual Leave",     nameAr: "إجازة سنوية",   leaveType: "annual",    annualDays: 21, accrualType: "monthly", carryOver: true,  maxCarryOverDays: 10, paid: true,  requiresApproval: true,  displayOrder: 0 },
    { code: "sick",      name: "Sick Leave",       nameAr: "إجازة مرضية",   leaveType: "sick",      annualDays: 30, accrualType: "annual",  carryOver: false, maxCarryOverDays: null, paid: true, requiresApproval: false, displayOrder: 1 },
    { code: "emergency", name: "Emergency Leave",  nameAr: "إجازة طارئة",   leaveType: "emergency", annualDays: 5,  accrualType: "annual",  carryOver: false, maxCarryOverDays: null, paid: true, requiresApproval: true,  displayOrder: 2 },
    { code: "unpaid",    name: "Unpaid Leave",     nameAr: "إجازة بدون أجر", leaveType: "unpaid",   annualDays: 0,  accrualType: "none",    carryOver: false, maxCarryOverDays: null, paid: false, requiresApproval: true,  displayOrder: 3 },
  ];
  for (const lp of defaultLeavePolicies) {
    await db.insert(hrLeavePoliciesTable).values({ workspaceId, ...lp }).onConflictDoNothing();
  }

  const defaultWorkLocations = [
    { code: "hq",     name: "Headquarters", nameAr: "المقر الرئيسي", type: "office", displayOrder: 0 },
    { code: "remote", name: "Remote",       nameAr: "عن بُعد",       type: "remote", displayOrder: 1 },
    { code: "hybrid", name: "Hybrid",       nameAr: "هجين",          type: "hybrid", displayOrder: 2 },
  ];
  for (const wl of defaultWorkLocations) {
    await db.insert(hrWorkLocationsTable).values({ workspaceId, ...wl }).onConflictDoNothing();
  }

  res.json({ ok: true, seeded: ["statuses", "employment_types", "contract_types", "document_types", "leave_policies", "work_locations"] });
});

// ── Employee Statuses ────────────────────────────────────────────────────────
router.get("/hr/foundation/statuses", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const rows = await db.select().from(hrEmployeeStatusesTable)
    .where(eq(hrEmployeeStatusesTable.workspaceId, workspaceId))
    .orderBy(asc(hrEmployeeStatusesTable.displayOrder), asc(hrEmployeeStatusesTable.name));
  res.json(rows);
});

router.post("/hr/foundation/statuses", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const { name, nameAr, color, isDefault, isFinal, allowSelfService, displayOrder, _computedCode } = req.body;
  const existing = await db.select({ code: hrEmployeeStatusesTable.code }).from(hrEmployeeStatusesTable)
    .where(eq(hrEmployeeStatusesTable.workspaceId, workspaceId));
  const taken = new Set(existing.map((r: { code: string }) => r.code).filter(Boolean));
  const code = uniquifyCode(String(_computedCode || toCode(name) || 'status'), taken);
  const [row] = await db.insert(hrEmployeeStatusesTable)
    .values({ workspaceId, code, name, nameAr, color, isDefault, isFinal, allowSelfService, displayOrder })
    .returning();
  res.status(201).json(row);
});

router.patch("/hr/foundation/statuses/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const { code, name, nameAr, color, isDefault, isFinal, allowSelfService, displayOrder, isActive } = req.body;
  const [row] = await db.update(hrEmployeeStatusesTable)
    .set({ code, name, nameAr, color, isDefault, isFinal, allowSelfService, displayOrder, isActive })
    .where(and(eq(hrEmployeeStatusesTable.id, id), eq(hrEmployeeStatusesTable.workspaceId, workspaceId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/hr/foundation/statuses/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(hrEmployeeStatusesTable)
    .where(and(eq(hrEmployeeStatusesTable.id, id), eq(hrEmployeeStatusesTable.workspaceId, workspaceId)));
  res.status(204).end();
});

// ── Employment Types ─────────────────────────────────────────────────────────
router.get("/hr/foundation/employment-types", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const rows = await db.select().from(hrEmploymentTypesTable)
    .where(eq(hrEmploymentTypesTable.workspaceId, workspaceId))
    .orderBy(asc(hrEmploymentTypesTable.displayOrder), asc(hrEmploymentTypesTable.name));
  res.json(rows);
});

router.post("/hr/foundation/employment-types", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const { name, nameAr, color, displayOrder, _computedCode } = req.body;
  const existing = await db.select({ code: hrEmploymentTypesTable.code }).from(hrEmploymentTypesTable)
    .where(eq(hrEmploymentTypesTable.workspaceId, workspaceId));
  const taken = new Set(existing.map((r: { code: string }) => r.code).filter(Boolean));
  const code = uniquifyCode(String(_computedCode || toCode(name) || 'emp_type'), taken);
  const [row] = await db.insert(hrEmploymentTypesTable)
    .values({ workspaceId, code, name, nameAr, color, displayOrder })
    .returning();
  res.status(201).json(row);
});

router.patch("/hr/foundation/employment-types/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const { code, name, nameAr, color, displayOrder, isActive } = req.body;
  const [row] = await db.update(hrEmploymentTypesTable)
    .set({ code, name, nameAr, color, displayOrder, isActive })
    .where(and(eq(hrEmploymentTypesTable.id, id), eq(hrEmploymentTypesTable.workspaceId, workspaceId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/hr/foundation/employment-types/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(hrEmploymentTypesTable)
    .where(and(eq(hrEmploymentTypesTable.id, id), eq(hrEmploymentTypesTable.workspaceId, workspaceId)));
  res.status(204).end();
});

// ── Contract Types ────────────────────────────────────────────────────────────
router.get("/hr/foundation/contract-types", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const rows = await db.select().from(hrContractTypesTable)
    .where(eq(hrContractTypesTable.workspaceId, workspaceId))
    .orderBy(asc(hrContractTypesTable.displayOrder), asc(hrContractTypesTable.name));
  res.json(rows);
});

router.post("/hr/foundation/contract-types", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const { name, nameAr, color, displayOrder, _computedCode } = req.body;
  const existing = await db.select({ code: hrContractTypesTable.code }).from(hrContractTypesTable)
    .where(eq(hrContractTypesTable.workspaceId, workspaceId));
  const taken = new Set(existing.map((r: { code: string }) => r.code).filter(Boolean));
  const code = uniquifyCode(String(_computedCode || toCode(name) || 'contract'), taken);
  const [row] = await db.insert(hrContractTypesTable)
    .values({ workspaceId, code, name, nameAr, color, displayOrder })
    .returning();
  res.status(201).json(row);
});

router.patch("/hr/foundation/contract-types/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const { code, name, nameAr, color, displayOrder, isActive } = req.body;
  const [row] = await db.update(hrContractTypesTable)
    .set({ code, name, nameAr, color, displayOrder, isActive })
    .where(and(eq(hrContractTypesTable.id, id), eq(hrContractTypesTable.workspaceId, workspaceId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/hr/foundation/contract-types/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(hrContractTypesTable)
    .where(and(eq(hrContractTypesTable.id, id), eq(hrContractTypesTable.workspaceId, workspaceId)));
  res.status(204).end();
});

// ── Work Locations ────────────────────────────────────────────────────────────
router.get("/hr/foundation/work-locations", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const rows = await db.select().from(hrWorkLocationsTable)
    .where(eq(hrWorkLocationsTable.workspaceId, workspaceId))
    .orderBy(asc(hrWorkLocationsTable.displayOrder), asc(hrWorkLocationsTable.name));
  res.json(rows);
});

router.post("/hr/foundation/work-locations", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const { name, nameAr, type, address, city, country, timezone, displayOrder, _computedCode } = req.body;
  const code = String(_computedCode || toCode(name) || 'location') || null;
  const [row] = await db.insert(hrWorkLocationsTable)
    .values({ workspaceId, name, nameAr, code, type, address, city, country, timezone, displayOrder })
    .returning();
  res.status(201).json(row);
});

router.patch("/hr/foundation/work-locations/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const { name, nameAr, code, type, address, city, country, timezone, displayOrder, isActive } = req.body;
  const [row] = await db.update(hrWorkLocationsTable)
    .set({ name, nameAr, code, type, address, city, country, timezone, displayOrder, isActive })
    .where(and(eq(hrWorkLocationsTable.id, id), eq(hrWorkLocationsTable.workspaceId, workspaceId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/hr/foundation/work-locations/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(hrWorkLocationsTable)
    .where(and(eq(hrWorkLocationsTable.id, id), eq(hrWorkLocationsTable.workspaceId, workspaceId)));
  res.status(204).end();
});

// ── Positions ─────────────────────────────────────────────────────────────────
router.get("/hr/foundation/positions", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const rows = await db.select({
    id: hrPositionsTable.id,
    code: hrPositionsTable.code,
    title: hrPositionsTable.title,
    titleAr: hrPositionsTable.titleAr,
    description: hrPositionsTable.description,
    status: hrPositionsTable.status,
    headcount: hrPositionsTable.headcount,
    currentOccupancy: hrPositionsTable.currentOccupancy,
    displayOrder: hrPositionsTable.displayOrder,
    isActive: hrPositionsTable.isActive,
    createdAt: hrPositionsTable.createdAt,
    updatedAt: hrPositionsTable.updatedAt,
    jobTitleId: hrPositionsTable.jobTitleId,
    jobTitleName: hrJobTitlesTable.name,
    orgUnitId: hrPositionsTable.orgUnitId,
    orgUnitName: hrOrgUnitsTable.name,
    jobGradeId: hrPositionsTable.jobGradeId,
    jobGradeName: hrJobGradesTable.name,
    workLocationId: hrPositionsTable.workLocationId,
    workLocationName: hrWorkLocationsTable.name,
  }).from(hrPositionsTable)
    .leftJoin(hrJobTitlesTable, eq(hrPositionsTable.jobTitleId, hrJobTitlesTable.id))
    .leftJoin(hrOrgUnitsTable, eq(hrPositionsTable.orgUnitId, hrOrgUnitsTable.id))
    .leftJoin(hrJobGradesTable, eq(hrPositionsTable.jobGradeId, hrJobGradesTable.id))
    .leftJoin(hrWorkLocationsTable, eq(hrPositionsTable.workLocationId, hrWorkLocationsTable.id))
    .where(eq(hrPositionsTable.workspaceId, workspaceId))
    .orderBy(asc(hrPositionsTable.displayOrder), asc(hrPositionsTable.title));
  res.json(rows);
});

router.post("/hr/foundation/positions", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const { title, titleAr, description, status, headcount, jobTitleId, orgUnitId, jobGradeId, workLocationId, displayOrder, _computedCode } = req.body;
  const code = String(_computedCode || toCode(title) || 'position') || null;
  const [row] = await db.insert(hrPositionsTable).values({
    workspaceId, code, title, titleAr, description,
    status: status ?? "vacant",
    headcount: headcount ?? 1,
    jobTitleId: jobTitleId ? Number(jobTitleId) : null,
    orgUnitId: orgUnitId ? Number(orgUnitId) : null,
    jobGradeId: jobGradeId ? Number(jobGradeId) : null,
    workLocationId: workLocationId ? Number(workLocationId) : null,
    displayOrder: displayOrder ?? 0,
  }).returning();
  res.status(201).json(row);
});

router.patch("/hr/foundation/positions/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const { code, title, titleAr, description, status, headcount, currentOccupancy, jobTitleId, orgUnitId, jobGradeId, workLocationId, displayOrder, isActive } = req.body;
  const [row] = await db.update(hrPositionsTable)
    .set({ code, title, titleAr, description, status, headcount, currentOccupancy, jobTitleId, orgUnitId, jobGradeId, workLocationId, displayOrder, isActive })
    .where(and(eq(hrPositionsTable.id, id), eq(hrPositionsTable.workspaceId, workspaceId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/hr/foundation/positions/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(hrPositionsTable)
    .where(and(eq(hrPositionsTable.id, id), eq(hrPositionsTable.workspaceId, workspaceId)));
  res.status(204).end();
});

// ── Document Types ────────────────────────────────────────────────────────────
router.get("/hr/foundation/document-types", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const rows = await db.select().from(hrDocumentTypesTable)
    .where(eq(hrDocumentTypesTable.workspaceId, workspaceId))
    .orderBy(asc(hrDocumentTypesTable.displayOrder), asc(hrDocumentTypesTable.name));
  res.json(rows);
});

router.post("/hr/foundation/document-types", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const { name, nameAr, hasExpiry, isRequired, displayOrder, _computedCode } = req.body;
  const code = String(_computedCode || toCode(name) || 'doc') || null;
  const [row] = await db.insert(hrDocumentTypesTable)
    .values({ workspaceId, name, nameAr, code, hasExpiry, isRequired, displayOrder })
    .returning();
  res.status(201).json(row);
});

router.patch("/hr/foundation/document-types/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const { name, nameAr, code, hasExpiry, isRequired, displayOrder, isActive } = req.body;
  const [row] = await db.update(hrDocumentTypesTable)
    .set({ name, nameAr, code, hasExpiry, isRequired, displayOrder, isActive })
    .where(and(eq(hrDocumentTypesTable.id, id), eq(hrDocumentTypesTable.workspaceId, workspaceId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/hr/foundation/document-types/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(hrDocumentTypesTable)
    .where(and(eq(hrDocumentTypesTable.id, id), eq(hrDocumentTypesTable.workspaceId, workspaceId)));
  res.status(204).end();
});

// ── Leave Policies ────────────────────────────────────────────────────────────
router.get("/hr/foundation/leave-policies", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const rows = await db.select().from(hrLeavePoliciesTable)
    .where(eq(hrLeavePoliciesTable.workspaceId, workspaceId))
    .orderBy(asc(hrLeavePoliciesTable.displayOrder), asc(hrLeavePoliciesTable.name));
  res.json(rows);
});

router.post("/hr/foundation/leave-policies", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const { name, nameAr, leaveType, annualDays, accrualType, carryOver, maxCarryOverDays, paid, requiresApproval, displayOrder, _computedCode } = req.body;
  const code = String(_computedCode || toCode(name) || 'leave') || null;
  const [row] = await db.insert(hrLeavePoliciesTable)
    .values({ workspaceId, name, nameAr, code, leaveType, annualDays, accrualType, carryOver, maxCarryOverDays, paid, requiresApproval, displayOrder })
    .returning();
  res.status(201).json(row);
});

router.patch("/hr/foundation/leave-policies/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const { name, nameAr, code, leaveType, annualDays, accrualType, carryOver, maxCarryOverDays, paid, requiresApproval, displayOrder, isActive } = req.body;
  const [row] = await db.update(hrLeavePoliciesTable)
    .set({ name, nameAr, code, leaveType, annualDays, accrualType, carryOver, maxCarryOverDays, paid, requiresApproval, displayOrder, isActive })
    .where(and(eq(hrLeavePoliciesTable.id, id), eq(hrLeavePoliciesTable.workspaceId, workspaceId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/hr/foundation/leave-policies/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(hrLeavePoliciesTable)
    .where(and(eq(hrLeavePoliciesTable.id, id), eq(hrLeavePoliciesTable.workspaceId, workspaceId)));
  res.status(204).end();
});

// ── Probation Policies ────────────────────────────────────────────────────────
router.get("/hr/foundation/probation-policies", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const rows = await db.select().from(hrProbationPoliciesTable)
    .where(eq(hrProbationPoliciesTable.workspaceId, workspaceId))
    .orderBy(asc(hrProbationPoliciesTable.name));
  res.json(rows);
});

router.post("/hr/foundation/probation-policies", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const { name, nameAr, durationDays, extendable, maxExtensionDays } = req.body;
  const [row] = await db.insert(hrProbationPoliciesTable)
    .values({ workspaceId, name, nameAr, durationDays, extendable, maxExtensionDays })
    .returning();
  res.status(201).json(row);
});

router.patch("/hr/foundation/probation-policies/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const { name, nameAr, durationDays, extendable, maxExtensionDays, isActive } = req.body;
  const [row] = await db.update(hrProbationPoliciesTable)
    .set({ name, nameAr, durationDays, extendable, maxExtensionDays, isActive })
    .where(and(eq(hrProbationPoliciesTable.id, id), eq(hrProbationPoliciesTable.workspaceId, workspaceId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/hr/foundation/probation-policies/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(hrProbationPoliciesTable)
    .where(and(eq(hrProbationPoliciesTable.id, id), eq(hrProbationPoliciesTable.workspaceId, workspaceId)));
  res.status(204).end();
});

// ═══════════════════════════════════════════════════════════════════════════════
// PAYROLL & COMPENSATION ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

// ── Salary Components ──────────────────────────────────────────────────────────

router.get("/hr/payroll/components", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const rows = await db.select().from(hrSalaryComponentsTable)
    .where(eq(hrSalaryComponentsTable.workspaceId, workspaceId))
    .orderBy(asc(hrSalaryComponentsTable.displayOrder), asc(hrSalaryComponentsTable.name));
  res.json(rows);
});

router.post("/hr/payroll/components", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId, userId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const { name, nameAr, componentType, calculationType, defaultValue, isTaxable, displayOrder, _computedCode } = req.body;
  if (!name) { res.status(400).json({ error: "name required" }); return; }
  const existing = await db.select({ code: hrSalaryComponentsTable.code })
    .from(hrSalaryComponentsTable).where(eq(hrSalaryComponentsTable.workspaceId, workspaceId));
  const takenCodes = new Set(existing.map((r) => r.code));
  const code = uniquifyCode(_computedCode || toCode(name), takenCodes);
  const [row] = await db.insert(hrSalaryComponentsTable).values({
    workspaceId, code, name, nameAr: nameAr ?? null,
    componentType: componentType ?? "allowance",
    calculationType: calculationType ?? "fixed",
    defaultValue: defaultValue ?? null,
    isTaxable: isTaxable ?? false,
    displayOrder: displayOrder ?? 0,
  }).returning();
  res.status(201).json(row);
});

router.patch("/hr/payroll/components/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const allowed = ["name", "nameAr", "componentType", "calculationType", "defaultValue", "isTaxable", "isActive", "displayOrder"];
  const patch = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  const [row] = await db.update(hrSalaryComponentsTable).set(patch)
    .where(and(eq(hrSalaryComponentsTable.id, id), eq(hrSalaryComponentsTable.workspaceId, workspaceId))).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/hr/payroll/components/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(hrSalaryComponentsTable)
    .where(and(eq(hrSalaryComponentsTable.id, id), eq(hrSalaryComponentsTable.workspaceId, workspaceId)));
  res.status(204).end();
});

// ── Salary Structures ──────────────────────────────────────────────────────────

router.get("/hr/payroll/structures", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const rows = await db.select().from(hrSalaryStructuresTable)
    .where(eq(hrSalaryStructuresTable.workspaceId, workspaceId))
    .orderBy(asc(hrSalaryStructuresTable.name));
  res.json(rows);
});

router.post("/hr/payroll/structures", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const { name, nameAr, description, currencyCode, isDefault, _computedCode } = req.body;
  if (!name) { res.status(400).json({ error: "name required" }); return; }
  const existing = await db.select({ code: hrSalaryStructuresTable.code })
    .from(hrSalaryStructuresTable).where(eq(hrSalaryStructuresTable.workspaceId, workspaceId));
  const takenCodes = new Set(existing.map((r) => r.code));
  const code = uniquifyCode(_computedCode || toCode(name), takenCodes);
  if (isDefault) {
    await db.update(hrSalaryStructuresTable).set({ isDefault: false })
      .where(eq(hrSalaryStructuresTable.workspaceId, workspaceId));
  }
  const [row] = await db.insert(hrSalaryStructuresTable).values({
    workspaceId, code, name, nameAr: nameAr ?? null,
    description: description ?? null,
    currencyCode: currencyCode ?? "SAR",
    isDefault: isDefault ?? false,
  }).returning();
  res.status(201).json(row);
});

router.patch("/hr/payroll/structures/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  if (req.body.isDefault) {
    await db.update(hrSalaryStructuresTable).set({ isDefault: false })
      .where(eq(hrSalaryStructuresTable.workspaceId, workspaceId));
  }
  const allowed = ["name", "nameAr", "description", "currencyCode", "isDefault", "isActive"];
  const patch = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  const [row] = await db.update(hrSalaryStructuresTable).set(patch)
    .where(and(eq(hrSalaryStructuresTable.id, id), eq(hrSalaryStructuresTable.workspaceId, workspaceId))).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/hr/payroll/structures/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(hrSalaryStructuresTable)
    .where(and(eq(hrSalaryStructuresTable.id, id), eq(hrSalaryStructuresTable.workspaceId, workspaceId)));
  res.status(204).end();
});

// Structure components (which salary components are in a structure)
router.get("/hr/payroll/structures/:id/components", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = await db
    .select({
      id: hrSalaryStructureComponentsTable.id,
      structureId: hrSalaryStructureComponentsTable.structureId,
      componentId: hrSalaryStructureComponentsTable.componentId,
      amount: hrSalaryStructureComponentsTable.amount,
      percentage: hrSalaryStructureComponentsTable.percentage,
      displayOrder: hrSalaryStructureComponentsTable.displayOrder,
      isActive: hrSalaryStructureComponentsTable.isActive,
      componentCode: hrSalaryComponentsTable.code,
      componentName: hrSalaryComponentsTable.name,
      componentNameAr: hrSalaryComponentsTable.nameAr,
      componentType: hrSalaryComponentsTable.componentType,
      calculationType: hrSalaryComponentsTable.calculationType,
      defaultValue: hrSalaryComponentsTable.defaultValue,
    })
    .from(hrSalaryStructureComponentsTable)
    .innerJoin(hrSalaryComponentsTable, eq(hrSalaryStructureComponentsTable.componentId, hrSalaryComponentsTable.id))
    .where(eq(hrSalaryStructureComponentsTable.structureId, id))
    .orderBy(asc(hrSalaryStructureComponentsTable.displayOrder));
  res.json(rows);
});

router.post("/hr/payroll/structures/:id/components", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const structureId = parseId(req.params.id);
  if (!structureId) { res.status(400).json({ error: "Invalid id" }); return; }
  const { componentId, amount, percentage, displayOrder } = req.body;
  if (!componentId) { res.status(400).json({ error: "componentId required" }); return; }
  const [row] = await db.insert(hrSalaryStructureComponentsTable).values({
    structureId,
    componentId: Number(componentId),
    amount: amount ?? null,
    percentage: percentage ?? null,
    displayOrder: displayOrder ?? 0,
  }).onConflictDoUpdate({
    target: [hrSalaryStructureComponentsTable.structureId, hrSalaryStructureComponentsTable.componentId],
    set: { amount: amount ?? null, percentage: percentage ?? null, displayOrder: displayOrder ?? 0, isActive: true },
  }).returning();
  res.status(201).json(row);
});

router.delete("/hr/payroll/structures/:id/components/:compId", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const structureId = parseId(req.params.id);
  const componentId = parseId(req.params.compId);
  if (!structureId || !componentId) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(hrSalaryStructureComponentsTable)
    .where(and(
      eq(hrSalaryStructureComponentsTable.structureId, structureId),
      eq(hrSalaryStructureComponentsTable.componentId, componentId),
    ));
  res.status(204).end();
});

// ── Salary Bands ───────────────────────────────────────────────────────────────

router.get("/hr/payroll/bands", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const rows = await db
    .select({
      id: hrSalaryBandsTable.id,
      workspaceId: hrSalaryBandsTable.workspaceId,
      code: hrSalaryBandsTable.code,
      name: hrSalaryBandsTable.name,
      nameAr: hrSalaryBandsTable.nameAr,
      gradeId: hrSalaryBandsTable.gradeId,
      gradeName: hrJobGradesTable.name,
      currencyCode: hrSalaryBandsTable.currencyCode,
      minAmount: hrSalaryBandsTable.minAmount,
      midpointAmount: hrSalaryBandsTable.midpointAmount,
      maxAmount: hrSalaryBandsTable.maxAmount,
      isActive: hrSalaryBandsTable.isActive,
      createdAt: hrSalaryBandsTable.createdAt,
    })
    .from(hrSalaryBandsTable)
    .leftJoin(hrJobGradesTable, eq(hrSalaryBandsTable.gradeId, hrJobGradesTable.id))
    .where(eq(hrSalaryBandsTable.workspaceId, workspaceId))
    .orderBy(asc(hrSalaryBandsTable.name));
  res.json(rows);
});

router.post("/hr/payroll/bands", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const { name, nameAr, gradeId, currencyCode, minAmount, midpointAmount, maxAmount, _computedCode } = req.body;
  if (!name) { res.status(400).json({ error: "name required" }); return; }
  const existing = await db.select({ code: hrSalaryBandsTable.code })
    .from(hrSalaryBandsTable).where(eq(hrSalaryBandsTable.workspaceId, workspaceId));
  const takenCodes = new Set(existing.map((r) => r.code));
  const code = uniquifyCode(_computedCode || toCode(name), takenCodes);
  const [row] = await db.insert(hrSalaryBandsTable).values({
    workspaceId, code, name, nameAr: nameAr ?? null,
    gradeId: gradeId ? Number(gradeId) : null,
    currencyCode: currencyCode ?? "SAR",
    minAmount: minAmount ?? "0",
    midpointAmount: midpointAmount ?? null,
    maxAmount: maxAmount ?? "0",
  }).returning();
  res.status(201).json(row);
});

router.patch("/hr/payroll/bands/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const allowed = ["name", "nameAr", "gradeId", "currencyCode", "minAmount", "midpointAmount", "maxAmount", "isActive"];
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(req.body)) {
    if (!allowed.includes(k)) continue;
    patch[k] = k === "gradeId" ? (v ? Number(v) : null) : v;
  }
  const [row] = await db.update(hrSalaryBandsTable).set(patch)
    .where(and(eq(hrSalaryBandsTable.id, id), eq(hrSalaryBandsTable.workspaceId, workspaceId))).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/hr/payroll/bands/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(hrSalaryBandsTable)
    .where(and(eq(hrSalaryBandsTable.id, id), eq(hrSalaryBandsTable.workspaceId, workspaceId)));
  res.status(204).end();
});

// ── Employee Compensation ──────────────────────────────────────────────────────

router.get("/hr/employees/:empId/compensation", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const empId = parseId(req.params.empId);
  if (!empId) { res.status(400).json({ error: "Invalid employee id" }); return; }
  const rows = await db
    .select({
      id: hrEmployeeCompensationsTable.id,
      employeeId: hrEmployeeCompensationsTable.employeeId,
      structureId: hrEmployeeCompensationsTable.structureId,
      structureName: hrSalaryStructuresTable.name,
      basicSalary: hrEmployeeCompensationsTable.basicSalary,
      currencyCode: hrEmployeeCompensationsTable.currencyCode,
      effectiveDate: hrEmployeeCompensationsTable.effectiveDate,
      endDate: hrEmployeeCompensationsTable.endDate,
      status: hrEmployeeCompensationsTable.status,
      notes: hrEmployeeCompensationsTable.notes,
      createdAt: hrEmployeeCompensationsTable.createdAt,
    })
    .from(hrEmployeeCompensationsTable)
    .leftJoin(hrSalaryStructuresTable, eq(hrEmployeeCompensationsTable.structureId, hrSalaryStructuresTable.id))
    .where(and(
      eq(hrEmployeeCompensationsTable.workspaceId, workspaceId),
      eq(hrEmployeeCompensationsTable.employeeId, empId),
    ))
    .orderBy(desc(hrEmployeeCompensationsTable.effectiveDate));
  res.json(rows);
});

router.post("/hr/employees/:empId/compensation", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId, userId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const empId = parseId(req.params.empId);
  if (!empId) { res.status(400).json({ error: "Invalid employee id" }); return; }
  const { structureId, basicSalary, currencyCode, effectiveDate, endDate, notes, items } = req.body;
  if (!basicSalary || !effectiveDate) { res.status(400).json({ error: "basicSalary and effectiveDate required" }); return; }
  // Mark previous active compensation as superseded
  await db.update(hrEmployeeCompensationsTable)
    .set({ status: "superseded", endDate: effectiveDate })
    .where(and(
      eq(hrEmployeeCompensationsTable.workspaceId, workspaceId),
      eq(hrEmployeeCompensationsTable.employeeId, empId),
      eq(hrEmployeeCompensationsTable.status, "active"),
    ));
  const [comp] = await db.insert(hrEmployeeCompensationsTable).values({
    workspaceId,
    employeeId: empId,
    structureId: structureId ? Number(structureId) : null,
    basicSalary: String(basicSalary),
    currencyCode: currencyCode ?? "SAR",
    effectiveDate,
    endDate: endDate ?? null,
    status: "active",
    notes: notes ?? null,
    createdBy: userId ?? null,
  }).returning();
  // Insert compensation items (overrides)
  if (items && Array.isArray(items) && items.length > 0) {
    await db.insert(hrEmployeeCompensationItemsTable).values(
      items.map((item: { componentId: number; amount?: string; percentage?: string; notes?: string }) => ({
        compensationId: comp.id,
        componentId: Number(item.componentId),
        amount: item.amount ?? null,
        percentage: item.percentage ?? null,
        notes: item.notes ?? null,
      }))
    );
  }
  res.status(201).json(comp);
});

router.get("/hr/employees/:empId/compensation/:compId/items", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const compId = parseId(req.params.compId);
  if (!compId) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = await db
    .select({
      id: hrEmployeeCompensationItemsTable.id,
      compensationId: hrEmployeeCompensationItemsTable.compensationId,
      componentId: hrEmployeeCompensationItemsTable.componentId,
      componentCode: hrSalaryComponentsTable.code,
      componentName: hrSalaryComponentsTable.name,
      componentNameAr: hrSalaryComponentsTable.nameAr,
      componentType: hrSalaryComponentsTable.componentType,
      amount: hrEmployeeCompensationItemsTable.amount,
      percentage: hrEmployeeCompensationItemsTable.percentage,
      notes: hrEmployeeCompensationItemsTable.notes,
    })
    .from(hrEmployeeCompensationItemsTable)
    .innerJoin(hrSalaryComponentsTable, eq(hrEmployeeCompensationItemsTable.componentId, hrSalaryComponentsTable.id))
    .where(eq(hrEmployeeCompensationItemsTable.compensationId, compId));
  res.json(rows);
});

// ── Payroll Runs ───────────────────────────────────────────────────────────────

router.get("/hr/payroll/runs", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const rows = await db.select().from(hrPayrollRunsTable)
    .where(eq(hrPayrollRunsTable.workspaceId, workspaceId))
    .orderBy(desc(hrPayrollRunsTable.periodYear), desc(hrPayrollRunsTable.periodMonth));
  res.json(rows);
});

router.post("/hr/payroll/runs", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId, userId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const { periodYear, periodMonth, currencyCode, notes } = req.body;
  if (!periodYear || !periodMonth) { res.status(400).json({ error: "periodYear and periodMonth required" }); return; }
  const y = Number(periodYear); const m = Number(periodMonth);
  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const name = `${monthNames[m - 1]} ${y}`;
  const code = `PAYROLL-${y}-${String(m).padStart(2, "0")}`;
  if (!assertLegacyPayrollWriteAllowed(req, res)) return;
  const [row] = await db.insert(hrPayrollRunsTable).values({
    workspaceId, code, name,
    periodYear: y, periodMonth: m,
    currencyCode: currencyCode ?? "SAR",
    status: "draft",
    notes: notes ?? null,
    createdBy: userId ?? null,
  }).returning();
  res.status(201).json(row);
});

router.get("/hr/payroll/runs/:id", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.select().from(hrPayrollRunsTable)
    .where(and(eq(hrPayrollRunsTable.id, id), eq(hrPayrollRunsTable.workspaceId, workspaceId)));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.patch("/hr/payroll/runs/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId, userId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  if (!assertLegacyPayrollWriteAllowed(req, res)) return;
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const { status, notes } = req.body;
  const patch: Record<string, unknown> = { notes };
  if (status) {
    patch.status = status;
    if (status === "approved") { patch.approvedAt = new Date(); patch.approvedBy = userId ?? null; }
    if (status === "paid") { patch.paidAt = new Date(); }
  }
  const [row] = await db.update(hrPayrollRunsTable).set(patch)
    .where(and(eq(hrPayrollRunsTable.id, id), eq(hrPayrollRunsTable.workspaceId, workspaceId))).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// Process a payroll run: compute payslips for all active employees
router.post("/hr/payroll/runs/:id/process", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId, userId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  if (!assertLegacyPayrollWriteAllowed(req, res)) return;
  const runId = parseId(req.params.id);
  if (!runId) { res.status(400).json({ error: "Invalid id" }); return; }

  const [run] = await db.select().from(hrPayrollRunsTable)
    .where(and(eq(hrPayrollRunsTable.id, runId), eq(hrPayrollRunsTable.workspaceId, workspaceId)));
  if (!run) { res.status(404).json({ error: "Run not found" }); return; }
  if (!["draft", "processing"].includes(run.status)) {
    res.status(400).json({ error: "Can only process draft/processing runs" }); return;
  }

  await db.update(hrPayrollRunsTable).set({ status: "processing", processedAt: new Date(), processedBy: userId ?? null })
    .where(eq(hrPayrollRunsTable.id, runId));

  // Get all active employees in workspace
  const employees = await db.select({ id: employeesTable.id })
    .from(employeesTable)
    .where(and(eq(employeesTable.workspaceId, workspaceId), eq(employeesTable.status, "active")));

  let totalBasic = 0, totalAllowances = 0, totalDeductions = 0, totalBonus = 0, totalOvertime = 0;

  for (const emp of employees) {
    // Get active compensation
    const [comp] = await db.select().from(hrEmployeeCompensationsTable)
      .where(and(
        eq(hrEmployeeCompensationsTable.workspaceId, workspaceId),
        eq(hrEmployeeCompensationsTable.employeeId, emp.id),
        eq(hrEmployeeCompensationsTable.status, "active"),
      ))
      .orderBy(desc(hrEmployeeCompensationsTable.effectiveDate))
      .limit(1);

    if (!comp) continue; // Skip employees without compensation

    const basic = parseFloat(comp.basicSalary) || 0;

    // Get structure components
    let structureComponents: Array<{
      componentId: number; componentCode: string; componentName: string;
      componentNameAr: string | null; componentType: string; calculationType: string;
      amount: string | null; percentage: string | null; displayOrder: number;
    }> = [];

    if (comp.structureId) {
      structureComponents = await db
        .select({
          componentId: hrSalaryStructureComponentsTable.componentId,
          componentCode: hrSalaryComponentsTable.code,
          componentName: hrSalaryComponentsTable.name,
          componentNameAr: hrSalaryComponentsTable.nameAr,
          componentType: hrSalaryComponentsTable.componentType,
          calculationType: hrSalaryComponentsTable.calculationType,
          amount: hrSalaryStructureComponentsTable.amount,
          percentage: hrSalaryStructureComponentsTable.percentage,
          displayOrder: hrSalaryStructureComponentsTable.displayOrder,
        })
        .from(hrSalaryStructureComponentsTable)
        .innerJoin(hrSalaryComponentsTable, eq(hrSalaryStructureComponentsTable.componentId, hrSalaryComponentsTable.id))
        .where(and(
          eq(hrSalaryStructureComponentsTable.structureId, comp.structureId),
          eq(hrSalaryStructureComponentsTable.isActive, true),
        ))
        .orderBy(asc(hrSalaryStructureComponentsTable.displayOrder));
    }

    // Get per-employee overrides
    const overrides = await db.select().from(hrEmployeeCompensationItemsTable)
      .where(eq(hrEmployeeCompensationItemsTable.compensationId, comp.id));
    const overrideMap = new Map(overrides.map((o) => [o.componentId, o]));

    // Delete existing payslip for this employee in this run (re-process)
    const [existingPayslip] = await db.select({ id: hrPayslipsTable.id })
      .from(hrPayslipsTable)
      .where(and(eq(hrPayslipsTable.payrollRunId, runId), eq(hrPayslipsTable.employeeId, emp.id)));
    if (existingPayslip) {
      await db.delete(hrPayslipLinesTable).where(eq(hrPayslipLinesTable.payslipId, existingPayslip.id));
      await db.delete(hrPayslipsTable).where(eq(hrPayslipsTable.id, existingPayslip.id));
    }

    // Build payslip lines
    const lines: Array<{ componentId: number | null; componentCode: string; componentName: string; componentNameAr: string | null; componentType: string; amount: string; displayOrder: number }> = [];

    // Base salary line
    lines.push({
      componentId: null,
      componentCode: "base_salary",
      componentName: "Basic Salary",
      componentNameAr: "الراتب الأساسي",
      componentType: "base",
      amount: String(basic),
      displayOrder: 0,
    });

    let allowances = 0, deductions = 0, bonus = 0, overtime = 0;

    for (const sc of structureComponents) {
      const override = overrideMap.get(sc.componentId);
      let amount = 0;
      const rawAmount = override?.amount ?? sc.amount;
      const rawPct = override?.percentage ?? sc.percentage;
      if (rawAmount) {
        amount = parseFloat(rawAmount) || 0;
      } else if (rawPct) {
        amount = (basic * (parseFloat(rawPct) || 0)) / 100;
      } else if (sc.calculationType === "percentage_of_basic" && rawPct) {
        amount = (basic * (parseFloat(rawPct) || 0)) / 100;
      }
      lines.push({
        componentId: sc.componentId,
        componentCode: sc.componentCode,
        componentName: sc.componentName,
        componentNameAr: sc.componentNameAr,
        componentType: sc.componentType,
        amount: String(amount),
        displayOrder: sc.displayOrder + 1,
      });
      if (sc.componentType === "allowance") allowances += amount;
      else if (sc.componentType === "deduction") deductions += amount;
      else if (sc.componentType === "bonus") bonus += amount;
      else if (sc.componentType === "overtime") overtime += amount;
    }

    const gross = basic + allowances + bonus + overtime;
    const net = gross - deductions;

    const [payslip] = await db.insert(hrPayslipsTable).values({
      workspaceId,
      payrollRunId: runId,
      employeeId: emp.id,
      compensationId: comp.id,
      basicSalary: String(basic),
      totalAllowances: String(allowances),
      totalDeductions: String(deductions),
      totalBonus: String(bonus),
      totalOvertime: String(overtime),
      grossSalary: String(gross),
      netSalary: String(net),
      currencyCode: comp.currencyCode ?? "SAR",
      status: "draft",
    }).returning();

    if (lines.length > 0) {
      await db.insert(hrPayslipLinesTable).values(
        lines.map((l) => ({ payslipId: payslip.id, ...l }))
      );
    }

    totalBasic += basic;
    totalAllowances += allowances;
    totalDeductions += deductions;
    totalBonus += bonus;
    totalOvertime += overtime;
  }

  const totalGross = totalBasic + totalAllowances + totalBonus + totalOvertime;
  const totalNet = totalGross - totalDeductions;

  const [updated] = await db.update(hrPayrollRunsTable).set({
    status: "approved",
    employeeCount: employees.length,
    totalBasic: String(totalBasic),
    totalAllowances: String(totalAllowances),
    totalDeductions: String(totalDeductions),
    totalBonus: String(totalBonus),
    totalOvertime: String(totalOvertime),
    totalGross: String(totalGross),
    totalNet: String(totalNet),
    approvedAt: new Date(),
    approvedBy: userId ?? null,
  }).where(eq(hrPayrollRunsTable.id, runId)).returning();

  res.json({ success: true, run: updated, payslipCount: employees.length });
});

// ── Payslips ───────────────────────────────────────────────────────────────────

router.get("/hr/payroll/runs/:runId/payslips", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const runId = parseId(req.params.runId);
  if (!runId) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = await db
    .select({
      id: hrPayslipsTable.id,
      payrollRunId: hrPayslipsTable.payrollRunId,
      employeeId: hrPayslipsTable.employeeId,
      employeeName: employeesTable.fullName,
      employeeNumber: employeesTable.employeeNumber,
      basicSalary: hrPayslipsTable.basicSalary,
      totalAllowances: hrPayslipsTable.totalAllowances,
      totalDeductions: hrPayslipsTable.totalDeductions,
      totalBonus: hrPayslipsTable.totalBonus,
      grossSalary: hrPayslipsTable.grossSalary,
      netSalary: hrPayslipsTable.netSalary,
      currencyCode: hrPayslipsTable.currencyCode,
      status: hrPayslipsTable.status,
    })
    .from(hrPayslipsTable)
    .innerJoin(employeesTable, eq(hrPayslipsTable.employeeId, employeesTable.id))
    .where(and(eq(hrPayslipsTable.workspaceId, workspaceId), eq(hrPayslipsTable.payrollRunId, runId)))
    .orderBy(asc(employeesTable.fullName));
  res.json(rows);
});

router.get("/hr/payroll/runs/:runId/payslips/:id", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const [payslip] = await db
    .select({
      id: hrPayslipsTable.id,
      payrollRunId: hrPayslipsTable.payrollRunId,
      employeeId: hrPayslipsTable.employeeId,
      employeeName: employeesTable.fullName,
      employeeNumber: employeesTable.employeeNumber,
      avatarUrl: employeesTable.avatarUrl,
      basicSalary: hrPayslipsTable.basicSalary,
      totalAllowances: hrPayslipsTable.totalAllowances,
      totalDeductions: hrPayslipsTable.totalDeductions,
      totalBonus: hrPayslipsTable.totalBonus,
      totalOvertime: hrPayslipsTable.totalOvertime,
      grossSalary: hrPayslipsTable.grossSalary,
      netSalary: hrPayslipsTable.netSalary,
      currencyCode: hrPayslipsTable.currencyCode,
      workingDays: hrPayslipsTable.workingDays,
      actualDays: hrPayslipsTable.actualDays,
      absentDays: hrPayslipsTable.absentDays,
      status: hrPayslipsTable.status,
      notes: hrPayslipsTable.notes,
    })
    .from(hrPayslipsTable)
    .innerJoin(employeesTable, eq(hrPayslipsTable.employeeId, employeesTable.id))
    .where(and(eq(hrPayslipsTable.workspaceId, workspaceId), eq(hrPayslipsTable.id, id)));
  if (!payslip) { res.status(404).json({ error: "Not found" }); return; }
  const lines = await db.select().from(hrPayslipLinesTable)
    .where(eq(hrPayslipLinesTable.payslipId, id))
    .orderBy(asc(hrPayslipLinesTable.displayOrder));
  res.json({ ...payslip, lines });
});

// Self-service payslips: see routes/me-payslips.ts (F6.3 canonical + PDF)

// ═══════════════════════════════════════════════════════════════════════════════
// LEAVE & ATTENDANCE ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

// ── Shifts ─────────────────────────────────────────────────────────────────────

router.get("/hr/attendance/shifts", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const rows = await db.select().from(hrShiftsTable)
    .where(eq(hrShiftsTable.workspaceId, workspaceId))
    .orderBy(asc(hrShiftsTable.displayOrder), asc(hrShiftsTable.name));
  res.json(rows);
});

router.post("/hr/attendance/shifts", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const { name, nameAr, startTime, endTime, breakMinutes, graceMinutes, isFlexible, displayOrder, _computedCode } = req.body;
  if (!name) { res.status(400).json({ error: "name required" }); return; }
  const existing = await db.select({ code: hrShiftsTable.code })
    .from(hrShiftsTable).where(eq(hrShiftsTable.workspaceId, workspaceId));
  const takenCodes = new Set(existing.map((r) => r.code));
  const code = uniquifyCode(_computedCode || toCode(name), takenCodes);
  const [row] = await db.insert(hrShiftsTable).values({
    workspaceId, code, name, nameAr: nameAr ?? null,
    startTime: startTime ?? "08:00",
    endTime: endTime ?? "17:00",
    breakMinutes: breakMinutes ? Number(breakMinutes) : 60,
    graceMinutes: graceMinutes ? Number(graceMinutes) : 15,
    isFlexible: isFlexible ?? false,
    displayOrder: displayOrder ?? 0,
  }).returning();
  res.status(201).json(row);
});

router.patch("/hr/attendance/shifts/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const allowed = ["name", "nameAr", "startTime", "endTime", "breakMinutes", "graceMinutes", "isFlexible", "isActive", "displayOrder"];
  const patch = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  const [row] = await db.update(hrShiftsTable).set(patch)
    .where(and(eq(hrShiftsTable.id, id), eq(hrShiftsTable.workspaceId, workspaceId))).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/hr/attendance/shifts/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(hrShiftsTable)
    .where(and(eq(hrShiftsTable.id, id), eq(hrShiftsTable.workspaceId, workspaceId)));
  res.status(204).end();
});

// ── Work Calendars ─────────────────────────────────────────────────────────────

router.get("/hr/attendance/calendars", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const rows = await db.select().from(hrWorkCalendarsTable)
    .where(eq(hrWorkCalendarsTable.workspaceId, workspaceId))
    .orderBy(asc(hrWorkCalendarsTable.name));
  res.json(rows);
});

router.post("/hr/attendance/calendars", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const { name, nameAr, workDays, timezone, isDefault, _computedCode } = req.body;
  if (!name) { res.status(400).json({ error: "name required" }); return; }
  const existing = await db.select({ code: hrWorkCalendarsTable.code })
    .from(hrWorkCalendarsTable).where(eq(hrWorkCalendarsTable.workspaceId, workspaceId));
  const takenCodes = new Set(existing.map((r) => r.code));
  const code = uniquifyCode(_computedCode || toCode(name), takenCodes);
  if (isDefault) {
    await db.update(hrWorkCalendarsTable).set({ isDefault: false })
      .where(eq(hrWorkCalendarsTable.workspaceId, workspaceId));
  }
  const [row] = await db.insert(hrWorkCalendarsTable).values({
    workspaceId, code, name, nameAr: nameAr ?? null,
    workDays: workDays ?? [1, 2, 3, 4, 5],
    timezone: timezone ?? "Asia/Riyadh",
    isDefault: isDefault ?? false,
  }).returning();
  res.status(201).json(row);
});

router.patch("/hr/attendance/calendars/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  if (req.body.isDefault) {
    await db.update(hrWorkCalendarsTable).set({ isDefault: false })
      .where(eq(hrWorkCalendarsTable.workspaceId, workspaceId));
  }
  const allowed = ["name", "nameAr", "workDays", "timezone", "isDefault", "isActive"];
  const patch = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  const [row] = await db.update(hrWorkCalendarsTable).set(patch)
    .where(and(eq(hrWorkCalendarsTable.id, id), eq(hrWorkCalendarsTable.workspaceId, workspaceId))).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/hr/attendance/calendars/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(hrWorkCalendarsTable)
    .where(and(eq(hrWorkCalendarsTable.id, id), eq(hrWorkCalendarsTable.workspaceId, workspaceId)));
  res.status(204).end();
});

// Calendar holidays
router.get("/hr/attendance/calendars/:id/holidays", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const calendarId = parseId(req.params.id);
  if (!calendarId) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = await db.select().from(hrCalendarHolidaysTable)
    .where(and(eq(hrCalendarHolidaysTable.workspaceId, workspaceId), eq(hrCalendarHolidaysTable.calendarId, calendarId)))
    .orderBy(asc(hrCalendarHolidaysTable.date));
  res.json(rows);
});

router.post("/hr/attendance/calendars/:id/holidays", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const calendarId = parseId(req.params.id);
  if (!calendarId) { res.status(400).json({ error: "Invalid id" }); return; }
  const { name, nameAr, date, type } = req.body;
  if (!name || !date) { res.status(400).json({ error: "name and date required" }); return; }
  const [row] = await db.insert(hrCalendarHolidaysTable).values({
    workspaceId, calendarId, name, nameAr: nameAr ?? null, date,
    type: type ?? "holiday",
  }).returning();
  res.status(201).json(row);
});

router.delete("/hr/attendance/calendars/:id/holidays/:hid", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const hid = parseId(req.params.hid);
  if (!hid) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(hrCalendarHolidaysTable)
    .where(and(eq(hrCalendarHolidaysTable.id, hid), eq(hrCalendarHolidaysTable.workspaceId, workspaceId)));
  res.status(204).end();
});

// ── Attendance Records ─────────────────────────────────────────────────────────

router.get("/hr/attendance", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const { employeeId, dateFrom, dateTo, status } = req.query as Record<string, string>;
  const conditions = [eq(hrAttendanceTable.workspaceId, workspaceId)];
  if (employeeId) conditions.push(eq(hrAttendanceTable.employeeId, Number(employeeId)));
  if (dateFrom) conditions.push(sql`${hrAttendanceTable.date} >= ${dateFrom}`);
  if (dateTo) conditions.push(sql`${hrAttendanceTable.date} <= ${dateTo}`);
  if (status) conditions.push(eq(hrAttendanceTable.status, status));
  const rows = await db
    .select({
      id: hrAttendanceTable.id,
      employeeId: hrAttendanceTable.employeeId,
      employeeName: employeesTable.fullName,
      employeeNumber: employeesTable.employeeNumber,
      date: hrAttendanceTable.date,
      checkIn: hrAttendanceTable.checkIn,
      checkOut: hrAttendanceTable.checkOut,
      status: hrAttendanceTable.status,
      sourceType: hrAttendanceTable.sourceType,
      lateMinutes: hrAttendanceTable.lateMinutes,
      earlyLeaveMinutes: hrAttendanceTable.earlyLeaveMinutes,
      overtimeMinutes: hrAttendanceTable.overtimeMinutes,
      notes: hrAttendanceTable.notes,
      shiftName: hrShiftsTable.name,
    })
    .from(hrAttendanceTable)
    .innerJoin(employeesTable, eq(hrAttendanceTable.employeeId, employeesTable.id))
    .leftJoin(hrShiftsTable, eq(hrAttendanceTable.shiftId, hrShiftsTable.id))
    .where(and(...conditions))
    .orderBy(desc(hrAttendanceTable.date), asc(employeesTable.fullName));
  res.json(rows);
});

router.post("/hr/attendance", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  if (!assertLegacyAttendanceWriteAllowed(req, res)) return;
  const { workspaceId, userId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const { employeeId, date, shiftId, checkIn, checkOut, status, sourceType, lateMinutes, earlyLeaveMinutes, overtimeMinutes, notes } = req.body;
  if (!employeeId || !date) { res.status(400).json({ error: "employeeId and date required" }); return; }
  const [row] = await db.insert(hrAttendanceTable).values({
    workspaceId,
    employeeId: Number(employeeId),
    date,
    shiftId: shiftId ? Number(shiftId) : null,
    checkIn: checkIn ?? null,
    checkOut: checkOut ?? null,
    status: status ?? "present",
    sourceType: sourceType ?? "manual",
    lateMinutes: lateMinutes ? Number(lateMinutes) : 0,
    earlyLeaveMinutes: earlyLeaveMinutes ? Number(earlyLeaveMinutes) : 0,
    overtimeMinutes: overtimeMinutes ? Number(overtimeMinutes) : 0,
    notes: notes ?? null,
    createdBy: userId ?? null,
  }).onConflictDoUpdate({
    target: [hrAttendanceTable.employeeId, hrAttendanceTable.date],
    set: {
      shiftId: shiftId ? Number(shiftId) : null,
      checkIn: checkIn ?? null,
      checkOut: checkOut ?? null,
      status: status ?? "present",
      lateMinutes: lateMinutes ? Number(lateMinutes) : 0,
      earlyLeaveMinutes: earlyLeaveMinutes ? Number(earlyLeaveMinutes) : 0,
      overtimeMinutes: overtimeMinutes ? Number(overtimeMinutes) : 0,
      notes: notes ?? null,
    },
  }).returning();
  res.status(201).json(row);
});

router.patch("/hr/attendance/:id", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  if (!assertLegacyAttendanceWriteAllowed(req, res)) return;
  const { workspaceId, userId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const allowed = ["checkIn", "checkOut", "status", "shiftId", "lateMinutes", "earlyLeaveMinutes", "overtimeMinutes", "notes", "sourceType"];
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(req.body)) {
    if (!allowed.includes(k)) continue;
    patch[k] = (k === "shiftId" && v) ? Number(v) : v;
  }
  if (req.body.status === "present" || req.body.status === "approved") {
    patch.approvedBy = userId ?? null;
  }
  const [row] = await db.update(hrAttendanceTable).set(patch)
    .where(and(eq(hrAttendanceTable.id, id), eq(hrAttendanceTable.workspaceId, workspaceId))).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/hr/attendance/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  if (!assertLegacyAttendanceWriteAllowed(req, res)) return;
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(hrAttendanceTable)
    .where(and(eq(hrAttendanceTable.id, id), eq(hrAttendanceTable.workspaceId, workspaceId)));
  res.status(204).end();
});

// Employee's own attendance (self-service)
router.get("/hr/me/attendance", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId, userId } = req;
  if (!workspaceId || !userId) { res.status(403).json({ error: "No workspace" }); return; }
  const [emp] = await db.select({ id: employeesTable.id })
    .from(employeesTable)
    .where(and(eq(employeesTable.workspaceId, workspaceId), eq(employeesTable.userId, userId)));
  if (!emp) { res.json([]); return; }
  const { dateFrom, dateTo } = req.query as Record<string, string>;
  const conditions = [eq(hrAttendanceTable.employeeId, emp.id)];
  if (dateFrom) conditions.push(sql`${hrAttendanceTable.date} >= ${dateFrom}`);
  if (dateTo) conditions.push(sql`${hrAttendanceTable.date} <= ${dateTo}`);
  const rows = await db.select().from(hrAttendanceTable)
    .where(and(...conditions))
    .orderBy(desc(hrAttendanceTable.date));
  res.json(rows);
});

// ── Leave Balances ─────────────────────────────────────────────────────────────

router.get("/hr/leave-balances", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const { year, employeeId } = req.query as Record<string, string>;
  const conditions = [eq(hrLeaveBalancesTable.workspaceId, workspaceId)];
  if (year) conditions.push(eq(hrLeaveBalancesTable.year, Number(year)));
  if (employeeId) conditions.push(eq(hrLeaveBalancesTable.employeeId, Number(employeeId)));
  const rows = await db
    .select({
      id: hrLeaveBalancesTable.id,
      employeeId: hrLeaveBalancesTable.employeeId,
      employeeName: employeesTable.fullName,
      employeeNumber: employeesTable.employeeNumber,
      leavePolicyId: hrLeaveBalancesTable.leavePolicyId,
      policyName: hrLeavePoliciesTable.name,
      leaveType: hrLeaveBalancesTable.leaveType,
      year: hrLeaveBalancesTable.year,
      entitled: hrLeaveBalancesTable.entitled,
      used: hrLeaveBalancesTable.used,
      pending: hrLeaveBalancesTable.pending,
      carriedForward: hrLeaveBalancesTable.carriedForward,
      manualAdjustment: hrLeaveBalancesTable.manualAdjustment,
      notes: hrLeaveBalancesTable.notes,
      updatedAt: hrLeaveBalancesTable.updatedAt,
    })
    .from(hrLeaveBalancesTable)
    .innerJoin(employeesTable, eq(hrLeaveBalancesTable.employeeId, employeesTable.id))
    .leftJoin(hrLeavePoliciesTable, eq(hrLeaveBalancesTable.leavePolicyId, hrLeavePoliciesTable.id))
    .where(and(...conditions))
    .orderBy(asc(employeesTable.fullName));
  res.json(rows);
});

router.post("/hr/leave-balances", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const { employeeId, leavePolicyId, leaveType, year, entitled, carriedForward, manualAdjustment, notes } = req.body;
  if (!employeeId || !year) { res.status(400).json({ error: "employeeId and year required" }); return; }
  const [row] = await db.insert(hrLeaveBalancesTable).values({
    workspaceId,
    employeeId: Number(employeeId),
    leavePolicyId: leavePolicyId ? Number(leavePolicyId) : null,
    leaveType: leaveType ?? "annual",
    year: Number(year),
    entitled: entitled ?? "0",
    carriedForward: carriedForward ?? "0",
    manualAdjustment: manualAdjustment ?? "0",
    notes: notes ?? null,
  }).onConflictDoUpdate({
    target: [hrLeaveBalancesTable.employeeId, hrLeaveBalancesTable.leavePolicyId, hrLeaveBalancesTable.year],
    set: { entitled, carriedForward, manualAdjustment, notes },
  }).returning();
  res.status(201).json(row);
});

router.patch("/hr/leave-balances/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const allowed = ["entitled", "used", "pending", "carriedForward", "manualAdjustment", "notes"];
  const patch = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  const [row] = await db.update(hrLeaveBalancesTable).set(patch)
    .where(and(eq(hrLeaveBalancesTable.id, id), eq(hrLeaveBalancesTable.workspaceId, workspaceId))).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// Bulk-initialize leave balances for all employees from a leave policy
router.post("/hr/leave-balances/bulk-init", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const { leavePolicyId, year } = req.body;
  if (!leavePolicyId || !year) { res.status(400).json({ error: "leavePolicyId and year required" }); return; }
  const [policy] = await db.select().from(hrLeavePoliciesTable)
    .where(and(eq(hrLeavePoliciesTable.id, Number(leavePolicyId)), eq(hrLeavePoliciesTable.workspaceId, workspaceId)));
  if (!policy) { res.status(404).json({ error: "Policy not found" }); return; }
  const employees = await db.select({ id: employeesTable.id })
    .from(employeesTable)
    .where(and(eq(employeesTable.workspaceId, workspaceId), eq(employeesTable.status, "active")));
  let created = 0;
  for (const emp of employees) {
    await db.insert(hrLeaveBalancesTable).values({
      workspaceId,
      employeeId: emp.id,
      leavePolicyId: Number(leavePolicyId),
      leaveType: policy.leaveType,
      year: Number(year),
      entitled: String(policy.annualDays),
    }).onConflictDoNothing();
    created++;
  }
  res.json({ success: true, created });
});

// Employee's own leave balances (self-service)
router.get("/hr/me/leave-balances", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId, userId } = req;
  if (!workspaceId || !userId) { res.status(403).json({ error: "No workspace" }); return; }
  const [emp] = await db.select({ id: employeesTable.id })
    .from(employeesTable)
    .where(and(eq(employeesTable.workspaceId, workspaceId), eq(employeesTable.userId, userId)));
  if (!emp) { res.json([]); return; }
  const { year } = req.query as Record<string, string>;
  const currentYear = year ? Number(year) : new Date().getFullYear();
  const rows = await db
    .select({
      id: hrLeaveBalancesTable.id,
      leavePolicyId: hrLeaveBalancesTable.leavePolicyId,
      policyName: hrLeavePoliciesTable.name,
      policyNameAr: hrLeavePoliciesTable.nameAr,
      leaveType: hrLeaveBalancesTable.leaveType,
      year: hrLeaveBalancesTable.year,
      entitled: hrLeaveBalancesTable.entitled,
      used: hrLeaveBalancesTable.used,
      pending: hrLeaveBalancesTable.pending,
      carriedForward: hrLeaveBalancesTable.carriedForward,
      manualAdjustment: hrLeaveBalancesTable.manualAdjustment,
    })
    .from(hrLeaveBalancesTable)
    .leftJoin(hrLeavePoliciesTable, eq(hrLeaveBalancesTable.leavePolicyId, hrLeavePoliciesTable.id))
    .where(and(
      eq(hrLeaveBalancesTable.workspaceId, workspaceId),
      eq(hrLeaveBalancesTable.employeeId, emp.id),
      eq(hrLeaveBalancesTable.year, currentYear),
    ));
  res.json(rows);
});

// Employee's own leave requests with balance update
router.post("/hr/me/leave-requests", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!(await assertLegacyLeaveWriteAllowed(req, res))) return;
  const { workspaceId, userId } = req;
  if (!workspaceId || !userId) { res.status(403).json({ error: "No workspace" }); return; }
  const [emp] = await db.select({ id: employeesTable.id })
    .from(employeesTable)
    .where(and(eq(employeesTable.workspaceId, workspaceId), eq(employeesTable.userId, userId)));
  if (!emp) { res.status(403).json({ error: "Not an employee" }); return; }
  const { leaveType, startDate, endDate, daysCount, reason, leavePolicyId } = req.body;
  if (!leaveType || !startDate || !endDate) { res.status(400).json({ error: "leaveType, startDate, endDate required" }); return; }
  const [leave] = await db.insert(hrEmployeeLeavesTable).values({
    workspaceId,
    employeeId: emp.id,
    leaveType,
    startDate,
    endDate,
    daysCount: daysCount ? Number(daysCount) : null,
    reason: reason ?? null,
    status: "pending",
    createdBy: userId ?? null,
  }).returning();
  // Update pending balance
  if (leavePolicyId && daysCount) {
    const year = new Date(startDate).getFullYear();
    const [bal] = await db.select().from(hrLeaveBalancesTable)
      .where(and(
        eq(hrLeaveBalancesTable.employeeId, emp.id),
        eq(hrLeaveBalancesTable.leavePolicyId, Number(leavePolicyId)),
        eq(hrLeaveBalancesTable.year, year),
      ));
    if (bal) {
      const newPending = (parseFloat(bal.pending) || 0) + Number(daysCount);
      await db.update(hrLeaveBalancesTable)
        .set({ pending: String(newPending) })
        .where(eq(hrLeaveBalancesTable.id, bal.id));
    }
  }
  res.status(201).json(leave);
});

// Approve/reject a leave request and update balance
router.patch("/hr/attendance/leaves/:id", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  if (!(await assertLegacyLeaveWriteAllowed(req, res, "patch"))) return;
  const { workspaceId, userId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const { status, notes } = req.body;
  const [leave] = await db.select().from(hrEmployeeLeavesTable)
    .where(and(eq(hrEmployeeLeavesTable.id, id), eq(hrEmployeeLeavesTable.workspaceId, workspaceId)));
  if (!leave) { res.status(404).json({ error: "Not found" }); return; }
  const patch: Record<string, unknown> = { status, notes };
  if (status === "approved") {
    patch.approvedBy = userId ?? null;
    patch.approvedAt = new Date();
  }
  const [updated] = await db.update(hrEmployeeLeavesTable).set(patch)
    .where(eq(hrEmployeeLeavesTable.id, id)).returning();
  // Update leave balance: if approved, move pending→used; if rejected, clear pending
  if (leave.daysCount) {
    const year = new Date(leave.startDate).getFullYear();
    const [bal] = await db.select().from(hrLeaveBalancesTable)
      .where(and(
        eq(hrLeaveBalancesTable.employeeId, leave.employeeId),
        eq(hrLeaveBalancesTable.leaveType, leave.leaveType),
        eq(hrLeaveBalancesTable.year, year),
      )).limit(1);
    if (bal) {
      const days = leave.daysCount;
      if (status === "approved") {
        const newUsed = (parseFloat(bal.used) || 0) + days;
        const newPending = Math.max(0, (parseFloat(bal.pending) || 0) - days);
        await db.update(hrLeaveBalancesTable).set({ used: String(newUsed), pending: String(newPending) })
          .where(eq(hrLeaveBalancesTable.id, bal.id));
      } else if (status === "rejected" || status === "cancelled") {
        const newPending = Math.max(0, (parseFloat(bal.pending) || 0) - days);
        await db.update(hrLeaveBalancesTable).set({ pending: String(newPending) })
          .where(eq(hrLeaveBalancesTable.id, bal.id));
      }
    }
  }
  res.json(updated);
});

// ── Attendance Import Template (dynamic Excel) ────────────────────────────────
router.get("/hr/attendance/import-template", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Template ──
  const headers = [
    "employee_number", "date", "check_in", "check_out",
    "status", "shift_name", "overtime_minutes", "late_minutes",
    "early_leave_minutes", "source_type", "notes",
  ];
  const headersAr = [
    "رقم الموظف", "التاريخ", "وقت الدخول", "وقت الخروج",
    "الحالة", "اسم الشيفت", "دقائق الأوفرتايم", "دقائق التأخير",
    "دقائق المغادرة المبكرة", "مصدر التسجيل", "ملاحظات",
  ];
  const examples = [
    ["EMP-001", "2026-05-01", "08:05", "17:10", "present", "Morning Shift", "30", "5", "0", "manual", "Normal day"],
    ["EMP-002", "2026-05-01", "", "", "absent", "", "0", "0", "0", "system", "Sick leave"],
    ["EMP-003", "2026-05-01", "08:00", "20:30", "present", "Morning Shift", "210", "0", "0", "manual", "Overtime day"],
  ];
  const templateData = [headersAr, headers, ...examples];
  const ws1 = XLSX.utils.aoa_to_sheet(templateData);
  ws1["!cols"] = headers.map(() => ({ wch: 20 }));
  XLSX.utils.book_append_sheet(wb, ws1, "Attendance Template");

  // ── Sheet 2: Instructions ──
  const instructions = [
    ["Field", "Description EN", "وصف عربي", "Required", "Format / Values"],
    ["employee_number", "Employee number for matching", "رقم الموظف للمطابقة", "YES", "e.g. EMP-001"],
    ["date", "Attendance date", "تاريخ الحضور", "YES", "YYYY-MM-DD"],
    ["check_in", "Check-in time", "وقت الدخول", "NO", "HH:MM (24h)"],
    ["check_out", "Check-out time", "وقت الخروج", "NO", "HH:MM (24h)"],
    ["status", "Attendance status", "حالة الحضور", "YES", "present | absent | late | half_day | on_leave | holiday | remote"],
    ["shift_name", "Shift name for auto-linking", "اسم الشيفت للربط التلقائي", "NO", "Must match existing shift name exactly"],
    ["overtime_minutes", "Overtime duration in minutes", "مدة الأوفرتايم بالدقائق", "NO", "Integer ≥ 0"],
    ["late_minutes", "Late arrival in minutes", "دقائق التأخير", "NO", "Integer ≥ 0"],
    ["early_leave_minutes", "Early departure in minutes", "دقائق المغادرة المبكرة", "NO", "Integer ≥ 0"],
    ["source_type", "Source of attendance record", "مصدر التسجيل", "NO", "manual | biometric | mobile | system"],
    ["notes", "Free text notes", "ملاحظات حرة", "NO", "Any text"],
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(instructions);
  ws2["!cols"] = [{ wch: 22 }, { wch: 35 }, { wch: 35 }, { wch: 10 }, { wch: 55 }];
  XLSX.utils.book_append_sheet(wb, ws2, "Instructions");

  // ── Sheet 3: Valid Status Values ──
  const statusVals = [
    ["Status Code", "English Label", "Arabic Label"],
    ["present", "Present", "حاضر"],
    ["absent", "Absent", "غائب"],
    ["late", "Late", "متأخر"],
    ["half_day", "Half Day", "نصف يوم"],
    ["on_leave", "On Leave", "إجازة"],
    ["holiday", "Holiday", "عطلة"],
    ["remote", "Remote", "عن بُعد"],
  ];
  const ws3 = XLSX.utils.aoa_to_sheet(statusVals);
  ws3["!cols"] = [{ wch: 15 }, { wch: 20 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, ws3, "Status Values");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="attendance_import_template.xlsx"`);
  res.send(buf);
});

// ── Attendance Import Preview ──────────────────────────────────────────────────
router.post("/hr/attendance/import/preview", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  if (!assertLegacyAttendanceWriteAllowed(req, res)) return;
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  const rawRows: Record<string, string>[] = Array.isArray(req.body.rows) ? req.body.rows : [];

  // Load employees and shifts for matching
  const empRows = await db.select({ id: employeesTable.id, number: employeesTable.employeeNumber, name: employeesTable.fullName })
    .from(employeesTable).where(eq(employeesTable.workspaceId, workspaceId));
  const empByNumber = new Map(empRows.map((e) => [String(e.number ?? "").toLowerCase(), e]));
  const empByName   = new Map(empRows.map((e) => [String(e.name ?? "").toLowerCase(), e]));

  const shiftRows = await db.select({ id: hrShiftsTable.id, name: hrShiftsTable.name })
    .from(hrShiftsTable).where(eq(hrShiftsTable.workspaceId, workspaceId));
  const shiftByName = new Map(shiftRows.map((s) => [String(s.name).toLowerCase(), s]));

  // Load existing attendance to detect duplicates
  const existingAtt = await db.select({ employeeId: hrAttendanceTable.employeeId, date: hrAttendanceTable.date })
    .from(hrAttendanceTable).where(eq(hrAttendanceTable.workspaceId, workspaceId));
  const existingSet = new Set(existingAtt.map((a) => `${a.employeeId}__${a.date}`));

  const VALID_STATUSES = new Set(["present","absent","late","half_day","on_leave","holiday","remote"]);
  const VALID_SOURCES  = new Set(["manual","biometric","mobile","system"]);
  const TIME_RE        = /^\d{1,2}:\d{2}$/;
  const DATE_RE        = /^\d{4}-\d{2}-\d{2}$/;

  // Field aliases (EN + AR headers)
  const getField = (row: Record<string, string>, ...keys: string[]): string => {
    for (const k of keys) {
      if (row[k] !== undefined && row[k] !== "") return String(row[k]).trim();
    }
    return "";
  };

  const result: {
    rowNum: number; raw: Record<string, string>;
    employeeNumber?: string; employeeId?: number; employeeName?: string;
    date?: string; checkIn?: string; checkOut?: string; status?: string;
    overtimeMinutes?: number; notes?: string;
    errors: string[]; warnings: string[]; isNew: boolean;
  }[] = [];

  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    const rowNum = i + 1;
    const errors: string[] = [];
    const warnings: string[] = [];

    const empNum  = getField(row, "employee_number", "رقم الموظف", "Employee Number", "employeeNumber");
    const dateStr = getField(row, "date", "التاريخ", "Date");
    const status  = getField(row, "status", "الحالة", "Status") || "present";
    const checkIn = getField(row, "check_in", "وقت الدخول", "Check In");
    const checkOut= getField(row, "check_out", "وقت الخروج", "Check Out");
    const otMins  = getField(row, "overtime_minutes", "دقائق الأوفرتايم", "Overtime Minutes");
    const shiftNm = getField(row, "shift_name", "اسم الشيفت", "Shift Name");
    const notes   = getField(row, "notes", "ملاحظات", "Notes");
    const srcType = getField(row, "source_type", "مصدر التسجيل", "Source Type") || "manual";

    if (!empNum) errors.push("employee_number is required");
    if (!dateStr) errors.push("date is required");
    else if (!DATE_RE.test(dateStr)) errors.push(`Invalid date format: "${dateStr}" (expected YYYY-MM-DD)`);
    if (status && !VALID_STATUSES.has(status)) errors.push(`Invalid status: "${status}"`);
    if (checkIn && !TIME_RE.test(checkIn)) errors.push(`Invalid check_in format: "${checkIn}" (expected HH:MM)`);
    if (checkOut && !TIME_RE.test(checkOut)) errors.push(`Invalid check_out format: "${checkOut}" (expected HH:MM)`);
    if (srcType && !VALID_SOURCES.has(srcType)) warnings.push(`Unknown source_type: "${srcType}", will use "manual"`);

    // Employee matching
    let matchedEmp = empByNumber.get(empNum.toLowerCase()) ?? empByName.get(empNum.toLowerCase());
    if (!matchedEmp && empNum) errors.push(`Employee not found: "${empNum}"`);

    // Shift matching
    let matchedShift: { id: number } | undefined;
    if (shiftNm) {
      matchedShift = shiftByName.get(shiftNm.toLowerCase());
      if (!matchedShift) warnings.push(`Shift not found: "${shiftNm}", will be ignored`);
    }

    // Duplicate check
    const isNew = !matchedEmp || !dateStr ? true : !existingSet.has(`${matchedEmp.id}__${dateStr}`);
    if (!isNew) warnings.push("Record already exists - will be updated");

    result.push({
      rowNum, raw: row,
      employeeNumber: empNum || undefined,
      employeeId: matchedEmp?.id,
      employeeName: matchedEmp?.name ?? undefined,
      date: DATE_RE.test(dateStr) ? dateStr : undefined,
      checkIn: checkIn || undefined,
      checkOut: checkOut || undefined,
      status: VALID_STATUSES.has(status) ? status : "present",
      overtimeMinutes: otMins ? parseInt(otMins, 10) : 0,
      notes: notes || undefined,
      errors, warnings, isNew,
    });
  }

  const valid   = result.filter((r) => r.errors.length === 0).length;
  const invalid = result.filter((r) => r.errors.length > 0).length;
  const newRecs = result.filter((r) => r.errors.length === 0 && r.isNew).length;
  const updRecs = result.filter((r) => r.errors.length === 0 && !r.isNew).length;

  res.json({ rows: result, stats: { total: result.length, valid, invalid, newRecords: newRecs, updateRecords: updRecs } });
});

// ── Attendance Import Confirm ──────────────────────────────────────────────────
router.post("/hr/attendance/import/confirm", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  if (!assertLegacyAttendanceWriteAllowed(req, res)) return;
  const { workspaceId, userId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  const rows: {
    employeeId?: number; date?: string; checkIn?: string; checkOut?: string;
    status?: string; overtimeMinutes?: number; notes?: string;
  }[] = Array.isArray(req.body.rows) ? req.body.rows : [];

  const validRows = rows.filter((r) => r.employeeId && r.date);
  if (validRows.length === 0) { res.json({ imported: 0, updated: 0, errors: [] }); return; }

  let imported = 0; let updated = 0; const errors: string[] = [];

  for (const row of validRows) {
    try {
      const existing = await db.select({ id: hrAttendanceTable.id })
        .from(hrAttendanceTable)
        .where(and(eq(hrAttendanceTable.workspaceId, workspaceId), eq(hrAttendanceTable.employeeId, row.employeeId!), sql`${hrAttendanceTable.date} = ${row.date}`))
        .limit(1);

      if (existing.length > 0) {
        await db.update(hrAttendanceTable)
          .set({ checkIn: row.checkIn ?? null, checkOut: row.checkOut ?? null, status: row.status ?? "present", overtimeMinutes: row.overtimeMinutes ?? 0, notes: row.notes ?? null, sourceType: "manual" })
          .where(eq(hrAttendanceTable.id, existing[0].id));
        updated++;
      } else {
        await db.insert(hrAttendanceTable).values({
          workspaceId, employeeId: row.employeeId!, date: row.date!,
          checkIn: row.checkIn ?? null, checkOut: row.checkOut ?? null,
          status: row.status ?? "present", sourceType: "manual",
          overtimeMinutes: row.overtimeMinutes ?? 0,
          notes: row.notes ?? null, createdBy: userId ?? null,
        });
        imported++;
      }

      // P20-B: parallel canonical ingestion (legacy path unchanged)
      try {
        const { ingestExcelRow } = await import("../lib/workforce-attendance/pipeline");
        await ingestExcelRow({
          workspaceId,
          employeeId: row.employeeId!,
          date: row.date!,
          checkIn: row.checkIn ?? null,
          checkOut: row.checkOut ?? null,
          userId: userId ?? undefined,
        });
      } catch (ingestErr) {
        errors.push(`Ingest ${row.employeeId}/${row.date}: ${String(ingestErr)}`);
      }
    } catch (e) {
      errors.push(`Row ${row.employeeId}/${row.date}: ${String(e)}`);
    }
  }

  res.json({ imported, updated, errors });
});

// ── Attendance Export ─────────────────────────────────────────────────────────
router.get("/hr/attendance/export", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const q = req.query as Record<string, string>;
  const mode = q.mode === "async" || q.mode === "sync" ? q.mode : "auto";
  try {
    await reportService.handleLegacyExport(req, res, {
      reportDefinitionKey: "hr.attendance.period",
      format: q.format ?? "xlsx",
      parameters: {
        dateFrom: q.dateFrom,
        dateTo: q.dateTo,
        status: q.status,
      },
      mode,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Export failed";
    res.status(message === "Forbidden" ? 403 : 400).json({ error: message });
  }
});

// ── Attendance Bulk Update ────────────────────────────────────────────────────
router.post("/hr/attendance/bulk", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  if (!assertLegacyAttendanceWriteAllowed(req, res)) return;
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const { ids, status, notes } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids array required" }); return; }

  const updateData: Record<string, unknown> = {};
  if (status) updateData.status = status;
  if (notes !== undefined) updateData.notes = notes;

  if (Object.keys(updateData).length === 0) { res.status(400).json({ error: "No fields to update" }); return; }

  await db.update(hrAttendanceTable)
    .set(updateData)
    .where(and(eq(hrAttendanceTable.workspaceId, workspaceId), sql`${hrAttendanceTable.id} = ANY(ARRAY[${sql.join(ids.map((i: number) => sql`${i}`), sql`, `)}]::int[])`));

  res.json({ updated: ids.length });
});

// ── Overtime Policies ─────────────────────────────────────────────────────────

router.get("/hr/overtime/policies", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const rows = await db.select().from(hrOvertimePoliciesTable)
    .where(eq(hrOvertimePoliciesTable.workspaceId, workspaceId))
    .orderBy(asc(hrOvertimePoliciesTable.name));
  res.json(rows);
});

router.post("/hr/overtime/policies", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const { name, nameAr, dayType, calculationType, rateMultiplier, fixedRatePerHour, maxHoursPerDay, maxHoursPerMonth, minThresholdMinutes, requiresApproval, autoCalculate, salaryComponentId, isActive, notes } = req.body;
  if (!name) { res.status(400).json({ error: "name required" }); return; }
  const [row] = await db.insert(hrOvertimePoliciesTable).values({
    workspaceId, name, nameAr: nameAr ?? null, dayType: dayType ?? "any",
    calculationType: calculationType ?? "multiplier",
    rateMultiplier: rateMultiplier ? String(rateMultiplier) : "1.5",
    fixedRatePerHour: fixedRatePerHour ? String(fixedRatePerHour) : null,
    maxHoursPerDay: maxHoursPerDay ? String(maxHoursPerDay) : null,
    maxHoursPerMonth: maxHoursPerMonth ? String(maxHoursPerMonth) : null,
    minThresholdMinutes: minThresholdMinutes ? Number(minThresholdMinutes) : 30,
    requiresApproval: requiresApproval !== false,
    autoCalculate: autoCalculate !== false,
    salaryComponentId: salaryComponentId ? Number(salaryComponentId) : null,
    isActive: isActive !== false,
    notes: notes ?? null,
  }).returning();
  res.status(201).json(row);
});

router.patch("/hr/overtime/policies/:id", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const allowed = ["name","nameAr","dayType","calculationType","rateMultiplier","fixedRatePerHour","maxHoursPerDay","maxHoursPerMonth","minThresholdMinutes","requiresApproval","autoCalculate","salaryComponentId","isActive","notes"];
  const updates: Record<string, unknown> = {};
  for (const k of allowed) { if (req.body[k] !== undefined) updates[k] = req.body[k]; }
  if (updates.minThresholdMinutes) updates.minThresholdMinutes = Number(updates.minThresholdMinutes);
  const [row] = await db.update(hrOvertimePoliciesTable).set(updates)
    .where(and(eq(hrOvertimePoliciesTable.id, id), eq(hrOvertimePoliciesTable.workspaceId, workspaceId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/hr/overtime/policies/:id", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(hrOvertimePoliciesTable)
    .where(and(eq(hrOvertimePoliciesTable.id, id), eq(hrOvertimePoliciesTable.workspaceId, workspaceId)));
  res.status(204).end();
});

// ── Overtime Records ─────────────────────────────────────────────────────────

router.get("/hr/overtime/records", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const { employeeId, dateFrom, dateTo, status } = req.query as Record<string, string>;
  const conditions = [eq(hrOvertimeRecordsTable.workspaceId, workspaceId)];
  if (employeeId) conditions.push(eq(hrOvertimeRecordsTable.employeeId, Number(employeeId)));
  if (dateFrom) conditions.push(sql`${hrOvertimeRecordsTable.date} >= ${dateFrom}`);
  if (dateTo)   conditions.push(sql`${hrOvertimeRecordsTable.date} <= ${dateTo}`);
  if (status)   conditions.push(eq(hrOvertimeRecordsTable.status, status));

  const approverAlias = alias(usersTable, "approver");
  const rows = await db
    .select({
      id: hrOvertimeRecordsTable.id,
      employeeId: hrOvertimeRecordsTable.employeeId,
      employeeName: employeesTable.fullName,
      employeeNumber: employeesTable.employeeNumber,
      date: hrOvertimeRecordsTable.date,
      startTime: hrOvertimeRecordsTable.startTime,
      endTime: hrOvertimeRecordsTable.endTime,
      durationMinutes: hrOvertimeRecordsTable.durationMinutes,
      calculatedAmount: hrOvertimeRecordsTable.calculatedAmount,
      status: hrOvertimeRecordsTable.status,
      policyId: hrOvertimeRecordsTable.policyId,
      policyName: hrOvertimePoliciesTable.name,
      shiftName: hrShiftsTable.name,
      approvedByName: approverAlias.fullName,
      approvedAt: hrOvertimeRecordsTable.approvedAt,
      notes: hrOvertimeRecordsTable.notes,
    })
    .from(hrOvertimeRecordsTable)
    .innerJoin(employeesTable, eq(hrOvertimeRecordsTable.employeeId, employeesTable.id))
    .leftJoin(hrOvertimePoliciesTable, eq(hrOvertimeRecordsTable.policyId, hrOvertimePoliciesTable.id))
    .leftJoin(hrShiftsTable, eq(hrOvertimeRecordsTable.shiftId, hrShiftsTable.id))
    .leftJoin(approverAlias, eq(hrOvertimeRecordsTable.approvedBy, approverAlias.id))
    .where(and(...conditions))
    .orderBy(desc(hrOvertimeRecordsTable.date), asc(employeesTable.fullName));
  res.json(rows);
});

router.post("/hr/overtime/records", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId, userId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const { employeeId, attendanceId, policyId, shiftId, date, startTime, endTime, durationMinutes, notes } = req.body;
  if (!employeeId || !date) { res.status(400).json({ error: "employeeId and date required" }); return; }

  let calcDuration = durationMinutes ? Number(durationMinutes) : 0;
  // Auto-compute duration from start/end if not provided
  if (!calcDuration && startTime && endTime) {
    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    calcDuration = Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
  }

  // Look up policy to calculate amount
  let calculatedAmount: string | null = null;
  if (policyId) {
    const [pol] = await db.select().from(hrOvertimePoliciesTable).where(eq(hrOvertimePoliciesTable.id, Number(policyId)));
    if (pol) {
      const hrs = calcDuration / 60;
      if (pol.calculationType === "fixed_rate" && pol.fixedRatePerHour) {
        calculatedAmount = String((hrs * parseFloat(pol.fixedRatePerHour)).toFixed(2));
      }
    }
  }

  // Determine initial status based on policy
  let initialStatus = "draft";
  if (policyId) {
    const [pol] = await db.select({ requiresApproval: hrOvertimePoliciesTable.requiresApproval })
      .from(hrOvertimePoliciesTable).where(eq(hrOvertimePoliciesTable.id, Number(policyId)));
    if (pol && !pol.requiresApproval) initialStatus = "approved";
  }

  const [row] = await db.insert(hrOvertimeRecordsTable).values({
    workspaceId,
    employeeId: Number(employeeId),
    attendanceId: attendanceId ? Number(attendanceId) : null,
    policyId: policyId ? Number(policyId) : null,
    shiftId: shiftId ? Number(shiftId) : null,
    date,
    startTime: startTime ?? null,
    endTime: endTime ?? null,
    durationMinutes: calcDuration,
    calculatedAmount,
    status: initialStatus,
    notes: notes ?? null,
    createdBy: userId ?? null,
  }).returning();
  res.status(201).json(row);
});

router.patch("/hr/overtime/records/:id", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId, userId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const { status, ...rest } = req.body;
  const updates: Record<string, unknown> = {};
  const allowed = ["date","startTime","endTime","durationMinutes","policyId","shiftId","calculatedAmount","notes","attendanceId"];
  for (const k of allowed) { if (rest[k] !== undefined) updates[k] = rest[k]; }
  if (updates.durationMinutes) updates.durationMinutes = Number(updates.durationMinutes);

  // Handle approval workflow
  if (status) {
    updates.status = status;
    if (status === "approved" || status === "rejected") {
      updates.approvedBy = userId ?? null;
      updates.approvedAt = new Date();
    }
  }

  const [row] = await db.update(hrOvertimeRecordsTable).set(updates)
    .where(and(eq(hrOvertimeRecordsTable.id, id), eq(hrOvertimeRecordsTable.workspaceId, workspaceId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/hr/overtime/records/:id", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(hrOvertimeRecordsTable)
    .where(and(eq(hrOvertimeRecordsTable.id, id), eq(hrOvertimeRecordsTable.workspaceId, workspaceId)));
  res.status(204).end();
});

// ── Overtime Auto-Calculate ───────────────────────────────────────────────────
// Scan attendance records in range, find those with overtimeMinutes > threshold, create OT records
router.post("/hr/overtime/calculate", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId, userId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const { dateFrom, dateTo, policyId } = req.body;

  // Load active auto-calculate policies
  const policies = await db.select().from(hrOvertimePoliciesTable)
    .where(and(eq(hrOvertimePoliciesTable.workspaceId, workspaceId), eq(hrOvertimePoliciesTable.isActive, true), eq(hrOvertimePoliciesTable.autoCalculate, true)));

  if (policies.length === 0) { res.json({ created: 0, skipped: 0, message: "No active auto-calculate policies found" }); return; }

  // Pick the first matching policy (or the specified one)
  const policy = policyId ? policies.find((p) => p.id === Number(policyId)) ?? policies[0] : policies[0];
  const threshold = policy.minThresholdMinutes;

  // Load attendance records with OT minutes above threshold
  const attConds = [
    eq(hrAttendanceTable.workspaceId, workspaceId),
    sql`${hrAttendanceTable.overtimeMinutes} >= ${threshold}`,
  ];
  if (dateFrom) attConds.push(sql`${hrAttendanceTable.date} >= ${dateFrom}`);
  if (dateTo)   attConds.push(sql`${hrAttendanceTable.date} <= ${dateTo}`);

  const attRows = await db.select({
    id: hrAttendanceTable.id,
    employeeId: hrAttendanceTable.employeeId,
    date: hrAttendanceTable.date,
    checkOut: hrAttendanceTable.checkOut,
    overtimeMinutes: hrAttendanceTable.overtimeMinutes,
    shiftId: hrAttendanceTable.shiftId,
  }).from(hrAttendanceTable).where(and(...attConds));

  // Find already-created OT records to skip duplicates
  const existingOtRows = await db.select({ attendanceId: hrOvertimeRecordsTable.attendanceId })
    .from(hrOvertimeRecordsTable)
    .where(and(eq(hrOvertimeRecordsTable.workspaceId, workspaceId), sql`${hrOvertimeRecordsTable.attendanceId} IS NOT NULL`));
  const existingAttIds = new Set(existingOtRows.map((r) => r.attendanceId));

  let created = 0; let skipped = 0;

  for (const att of attRows) {
    if (existingAttIds.has(att.id)) { skipped++; continue; }
    const mins = att.overtimeMinutes ?? 0;
    if (mins < threshold) { skipped++; continue; }

    let calculatedAmount: string | null = null;
    const hrs = mins / 60;
    if (policy.calculationType === "fixed_rate" && policy.fixedRatePerHour) {
      calculatedAmount = String((hrs * parseFloat(policy.fixedRatePerHour)).toFixed(2));
    }

    const initialStatus = policy.requiresApproval ? "pending" : "approved";

    await db.insert(hrOvertimeRecordsTable).values({
      workspaceId,
      employeeId: att.employeeId,
      attendanceId: att.id,
      policyId: policy.id,
      shiftId: att.shiftId ?? null,
      date: att.date,
      durationMinutes: mins,
      calculatedAmount,
      status: initialStatus,
      createdBy: userId ?? null,
    });
    created++;
  }

  res.json({ created, skipped, policyUsed: policy.name });
});

// List leave requests (admin view)
router.get("/hr/attendance/leaves", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId } = req;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const { employeeId, status, leaveType } = req.query as Record<string, string>;
  const conditions = [eq(hrEmployeeLeavesTable.workspaceId, workspaceId)];
  if (employeeId) conditions.push(eq(hrEmployeeLeavesTable.employeeId, Number(employeeId)));
  if (status) conditions.push(eq(hrEmployeeLeavesTable.status, status));
  if (leaveType) conditions.push(eq(hrEmployeeLeavesTable.leaveType, leaveType));
  const rows = await db
    .select({
      id: hrEmployeeLeavesTable.id,
      employeeId: hrEmployeeLeavesTable.employeeId,
      employeeName: employeesTable.fullName,
      employeeNumber: employeesTable.employeeNumber,
      leaveType: hrEmployeeLeavesTable.leaveType,
      startDate: hrEmployeeLeavesTable.startDate,
      endDate: hrEmployeeLeavesTable.endDate,
      daysCount: hrEmployeeLeavesTable.daysCount,
      status: hrEmployeeLeavesTable.status,
      reason: hrEmployeeLeavesTable.reason,
      createdAt: hrEmployeeLeavesTable.createdAt,
    })
    .from(hrEmployeeLeavesTable)
    .innerJoin(employeesTable, eq(hrEmployeeLeavesTable.employeeId, employeesTable.id))
    .where(and(...conditions))
    .orderBy(desc(hrEmployeeLeavesTable.createdAt));
  res.json(rows);
});

export default router;
