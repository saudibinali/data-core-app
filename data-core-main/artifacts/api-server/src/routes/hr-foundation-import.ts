import { Router, type IRouter } from "express";
import * as XLSX from "xlsx";
import { db } from "@workspace/db";
import {
  hrJobGradesTable,
  hrJobTitlesTable,
  hrOrgUnitsTable,
  hrWorkLocationsTable,
  hrEmploymentTypesTable,
  hrEmployeeStatusesTable,
  hrContractTypesTable,
  hrDocumentTypesTable,
  hrLeavePoliciesTable,
  hrProbationPoliciesTable,
  hrPositionsTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import {
  type AuthRequest,
  requireAuth,
  requireWorkspaceAdmin,
} from "../middlewares/requireAuth";

const router: IRouter = Router();

type Category =
  | "job-grades"
  | "job-titles"
  | "org-units"
  | "work-locations"
  | "employment-types"
  | "employee-statuses"
  | "contract-types"
  | "document-types"
  | "leave-policies"
  | "probation-policies"
  | "positions";

function isCategory(v: string): v is Category {
  return v === "job-grades"
    || v === "job-titles"
    || v === "org-units"
    || v === "work-locations"
    || v === "employment-types"
    || v === "employee-statuses"
    || v === "contract-types"
    || v === "document-types"
    || v === "leave-policies"
    || v === "probation-policies"
    || v === "positions";
}

function norm(v: unknown): string {
  return String(v ?? "").trim();
}

function normCode(v: unknown): string {
  return norm(v).toLowerCase();
}

function boolFromCell(v: unknown, fallback = true): boolean {
  const s = norm(v).toLowerCase();
  if (!s) return fallback;
  if (s === "1" || s === "true" || s === "yes" || s === "y" || s === "نعم") return true;
  if (s === "0" || s === "false" || s === "no" || s === "n" || s === "لا") return false;
  return fallback;
}

function intFromCell(v: unknown, fallback: number | null = null): number | null {
  const s = norm(v);
  if (!s) return fallback;
  const n = Number(s);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function makeTemplate(category: Category): Buffer {
  const wb = XLSX.utils.book_new();

  const rows: Array<Record<string, unknown>> = [];

  if (category === "job-grades") {
    rows.push({
      code: "G1",
      name: "Grade 1",
      name_ar: "الدرجة 1",
      level: 1,
      description: "",
      display_order: 0,
      is_active: true,
    });
  } else if (category === "job-titles") {
    rows.push({
      code: "ENG1",
      name: "Engineer",
      name_ar: "مهندس",
      grade_code: "G1",
      description: "",
      display_order: 0,
      is_active: true,
    });
  } else if (category === "org-units") {
    rows.push({
      code: "IT",
      name: "IT Department",
      name_ar: "قسم تقنية المعلومات",
      type: "department",
      parent_code: "",
      display_order: 0,
      is_active: true,
    });
  } else if (category === "work-locations") {
    rows.push({
      code: "HQ",
      name: "Headquarters",
      name_ar: "المقر الرئيسي",
      type: "office",
      country: "SA",
      city: "Riyadh",
      timezone: "Asia/Riyadh",
      address: "",
      display_order: 0,
      is_active: true,
    });
  } else if (category === "employment-types") {
    rows.push({
      code: "full_time",
      name: "Full-time",
      name_ar: "دوام كامل",
      color: "#6366f1",
      display_order: 0,
      is_active: true,
    });
  } else if (category === "employee-statuses") {
    rows.push({
      code: "active",
      name: "Active",
      name_ar: "نشط",
      color: "#22c55e",
      is_default: true,
      is_final: false,
      allow_self_service: true,
      display_order: 0,
      is_active: true,
    });
  } else if (category === "contract-types") {
    rows.push({
      code: "annual",
      name: "Annual",
      name_ar: "سنوي",
      color: "#6366f1",
      display_order: 0,
      is_active: true,
    });
  } else if (category === "document-types") {
    rows.push({
      code: "national_id",
      name: "National ID",
      name_ar: "الهوية الوطنية",
      has_expiry: true,
      is_required: true,
      display_order: 0,
      is_active: true,
    });
  } else if (category === "leave-policies") {
    rows.push({
      code: "annual",
      name: "Annual Leave",
      name_ar: "إجازة سنوية",
      leave_type: "annual",
      annual_days: 21,
      accrual_type: "monthly",
      carry_over: true,
      max_carry_over_days: 10,
      paid: true,
      requires_approval: true,
      display_order: 0,
      is_active: true,
    });
  } else if (category === "probation-policies") {
    rows.push({
      name: "Standard probation",
      name_ar: "فترة اختبار قياسية",
      duration_days: 90,
      extendable: false,
      max_extension_days: "",
      is_active: true,
    });
  } else if (category === "positions") {
    rows.push({
      code: "POS-ENG-RYD-001",
      title: "Engineer — Riyadh",
      title_ar: "مهندس — الرياض",
      status: "vacant",
      headcount: 1,
      org_unit_code: "IT",
      job_title_code: "ENG1",
      job_grade_code: "G1",
      work_location_code: "HQ",
      display_order: 0,
      is_active: true,
    });
  }

  const ws = XLSX.utils.json_to_sheet(rows, { header: Object.keys(rows[0] ?? {}) });
  XLSX.utils.book_append_sheet(wb, ws, "Template");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

router.get("/hr/foundation/import/:category/template", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const category = String(req.params.category ?? "");
  if (!isCategory(category)) { res.status(400).json({ error: "Invalid category" }); return; }

  const buf = makeTemplate(category);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${category}_template.xlsx"`);
  res.send(buf);
});

type PreviewAction = "create" | "update" | "skip" | "reject";
type PreviewRow = { rowIndex: number; action: PreviewAction; code: string; name: string; errors: string[]; warnings: string[]; data: Record<string, unknown> };

async function previewWorkLocations(workspaceId: number, rows: Record<string, unknown>[]): Promise<{ rows: PreviewRow[]; summary: Record<string, number> }> {
  const existing = await db
    .select({ id: hrWorkLocationsTable.id, code: hrWorkLocationsTable.code })
    .from(hrWorkLocationsTable)
    .where(eq(hrWorkLocationsTable.workspaceId, workspaceId));
  const byCode = new Map(existing.filter((e) => e.code).map((e) => [normCode(e.code), e.id]));

  const seen = new Set<string>();
  const out: PreviewRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? {};
    const code = norm(r.code);
    const name = norm(r.name);
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!code) errors.push("code is required");
    if (!name) errors.push("name is required");
    const key = normCode(code);
    if (key && seen.has(key)) errors.push(`duplicate code in file: ${code}`);
    if (key) seen.add(key);

    const type = norm(r.type) || "office";
    const country = norm(r.country) || null;
    const city = norm(r.city) || null;
    const timezone = norm(r.timezone) || null;
    const address = norm(r.address) || null;
    const displayOrder = intFromCell(r.display_order, 0) ?? 0;
    const isActive = boolFromCell(r.is_active, true);
    const nameAr = norm(r.name_ar) || null;

    const existingId = key ? byCode.get(key) : undefined;
    const action: PreviewAction = errors.length > 0 ? "reject" : existingId ? "update" : "create";

    out.push({
      rowIndex: i + 1,
      action,
      code,
      name,
      errors,
      warnings,
      data: { code, name, nameAr, type, country, city, timezone, address, displayOrder, isActive, existingId: existingId ?? null },
    });
  }
  const summary = {
    total: out.length,
    create: out.filter((x) => x.action === "create").length,
    update: out.filter((x) => x.action === "update").length,
    reject: out.filter((x) => x.action === "reject").length,
    skip: out.filter((x) => x.action === "skip").length,
  };
  return { rows: out, summary };
}

async function previewEmploymentTypes(workspaceId: number, rows: Record<string, unknown>[]): Promise<{ rows: PreviewRow[]; summary: Record<string, number> }> {
  const existing = await db
    .select({ id: hrEmploymentTypesTable.id, code: hrEmploymentTypesTable.code })
    .from(hrEmploymentTypesTable)
    .where(eq(hrEmploymentTypesTable.workspaceId, workspaceId));
  const byCode = new Map(existing.filter((e) => e.code).map((e) => [normCode(e.code), e.id]));

  const seen = new Set<string>();
  const out: PreviewRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? {};
    const code = norm(r.code);
    const name = norm(r.name);
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!code) errors.push("code is required");
    if (!name) errors.push("name is required");
    const key = normCode(code);
    if (key && seen.has(key)) errors.push(`duplicate code in file: ${code}`);
    if (key) seen.add(key);

    const nameAr = norm(r.name_ar) || null;
    const color = norm(r.color) || "#6366f1";
    const displayOrder = intFromCell(r.display_order, 0) ?? 0;
    const isActive = boolFromCell(r.is_active, true);

    const existingId = key ? byCode.get(key) : undefined;
    const action: PreviewAction = errors.length > 0 ? "reject" : existingId ? "update" : "create";

    out.push({
      rowIndex: i + 1,
      action,
      code,
      name,
      errors,
      warnings,
      data: { code, name, nameAr, color, displayOrder, isActive, existingId: existingId ?? null },
    });
  }
  const summary = {
    total: out.length,
    create: out.filter((x) => x.action === "create").length,
    update: out.filter((x) => x.action === "update").length,
    reject: out.filter((x) => x.action === "reject").length,
    skip: out.filter((x) => x.action === "skip").length,
  };
  return { rows: out, summary };
}

async function previewEmployeeStatuses(workspaceId: number, rows: Record<string, unknown>[]): Promise<{ rows: PreviewRow[]; summary: Record<string, number> }> {
  const existing = await db
    .select({ id: hrEmployeeStatusesTable.id, code: hrEmployeeStatusesTable.code })
    .from(hrEmployeeStatusesTable)
    .where(eq(hrEmployeeStatusesTable.workspaceId, workspaceId));
  const byCode = new Map(existing.filter((e) => e.code).map((e) => [normCode(e.code), e.id]));

  const seen = new Set<string>();
  const out: PreviewRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? {};
    const code = norm(r.code);
    const name = norm(r.name);
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!code) errors.push("code is required");
    if (!name) errors.push("name is required");
    const key = normCode(code);
    if (key && seen.has(key)) errors.push(`duplicate code in file: ${code}`);
    if (key) seen.add(key);

    const nameAr = norm(r.name_ar) || null;
    const color = norm(r.color) || "#6366f1";
    const displayOrder = intFromCell(r.display_order, 0) ?? 0;
    const isActive = boolFromCell(r.is_active, true);
    const isDefault = boolFromCell(r.is_default, false);
    const isFinal = boolFromCell(r.is_final, false);
    const allowSelfService = boolFromCell(r.allow_self_service, false);

    const existingId = key ? byCode.get(key) : undefined;
    const action: PreviewAction = errors.length > 0 ? "reject" : existingId ? "update" : "create";

    out.push({
      rowIndex: i + 1,
      action,
      code,
      name,
      errors,
      warnings,
      data: {
        code, name, nameAr, color,
        displayOrder, isActive,
        isDefault, isFinal, allowSelfService,
        existingId: existingId ?? null,
      },
    });
  }
  const summary = {
    total: out.length,
    create: out.filter((x) => x.action === "create").length,
    update: out.filter((x) => x.action === "update").length,
    reject: out.filter((x) => x.action === "reject").length,
    skip: out.filter((x) => x.action === "skip").length,
  };
  return { rows: out, summary };
}

async function previewJobGrades(workspaceId: number, rows: Record<string, unknown>[]): Promise<{ rows: PreviewRow[]; summary: Record<string, number> }> {
  const existing = await db
    .select({ id: hrJobGradesTable.id, code: hrJobGradesTable.code })
    .from(hrJobGradesTable)
    .where(eq(hrJobGradesTable.workspaceId, workspaceId));
  const byCode = new Map(existing.filter((e) => e.code).map((e) => [normCode(e.code), e.id]));

  const seen = new Set<string>();
  const out: PreviewRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? {};
    const code = norm(r.code);
    const name = norm(r.name);
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!code) errors.push("code is required");
    if (!name) errors.push("name is required");
    const key = normCode(code);
    if (key && seen.has(key)) errors.push(`duplicate code in file: ${code}`);
    if (key) seen.add(key);

    const level = intFromCell(r.level, null);
    const displayOrder = intFromCell(r.display_order, 0) ?? 0;
    const isActive = boolFromCell(r.is_active, true);
    const nameAr = norm(r.name_ar) || null;
    const description = norm(r.description) || null;

    const existingId = key ? byCode.get(key) : undefined;
    const action: PreviewAction = errors.length > 0 ? "reject" : existingId ? "update" : "create";

    out.push({
      rowIndex: i + 1,
      action,
      code,
      name,
      errors,
      warnings,
      data: { code, name, nameAr, level, description, displayOrder, isActive, existingId: existingId ?? null },
    });
  }
  const summary = {
    total: out.length,
    create: out.filter((x) => x.action === "create").length,
    update: out.filter((x) => x.action === "update").length,
    reject: out.filter((x) => x.action === "reject").length,
    skip: out.filter((x) => x.action === "skip").length,
  };
  return { rows: out, summary };
}

async function previewJobTitles(workspaceId: number, rows: Record<string, unknown>[]): Promise<{ rows: PreviewRow[]; summary: Record<string, number> }> {
  const [existingTitles, grades] = await Promise.all([
    db.select({ id: hrJobTitlesTable.id, code: hrJobTitlesTable.code }).from(hrJobTitlesTable).where(eq(hrJobTitlesTable.workspaceId, workspaceId)),
    db.select({ id: hrJobGradesTable.id, code: hrJobGradesTable.code }).from(hrJobGradesTable).where(eq(hrJobGradesTable.workspaceId, workspaceId)),
  ]);
  const byCode = new Map(existingTitles.filter((e) => e.code).map((e) => [normCode(e.code), e.id]));
  const gradeByCode = new Map(grades.filter((g) => g.code).map((g) => [normCode(g.code), g.id]));

  const seen = new Set<string>();
  const out: PreviewRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? {};
    const code = norm(r.code);
    const name = norm(r.name);
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!code) errors.push("code is required");
    if (!name) errors.push("name is required");
    const key = normCode(code);
    if (key && seen.has(key)) errors.push(`duplicate code in file: ${code}`);
    if (key) seen.add(key);

    const gradeCode = norm(r.grade_code);
    const gradeId = gradeCode ? (gradeByCode.get(normCode(gradeCode)) ?? null) : null;
    if (gradeCode && !gradeId) errors.push(`grade_code "${gradeCode}" not found (import grades first)`);

    const displayOrder = intFromCell(r.display_order, 0) ?? 0;
    const isActive = boolFromCell(r.is_active, true);
    const nameAr = norm(r.name_ar) || null;
    const description = norm(r.description) || null;

    const existingId = key ? byCode.get(key) : undefined;
    const action: PreviewAction = errors.length > 0 ? "reject" : existingId ? "update" : "create";

    out.push({
      rowIndex: i + 1,
      action,
      code,
      name,
      errors,
      warnings,
      data: { code, name, nameAr, gradeCode: gradeCode || null, gradeId, description, displayOrder, isActive, existingId: existingId ?? null },
    });
  }
  const summary = {
    total: out.length,
    create: out.filter((x) => x.action === "create").length,
    update: out.filter((x) => x.action === "update").length,
    reject: out.filter((x) => x.action === "reject").length,
    skip: out.filter((x) => x.action === "skip").length,
  };
  return { rows: out, summary };
}

async function previewOrgUnits(workspaceId: number, rows: Record<string, unknown>[]): Promise<{ rows: PreviewRow[]; summary: Record<string, number> }> {
  const existing = await db
    .select({ id: hrOrgUnitsTable.id, code: hrOrgUnitsTable.code })
    .from(hrOrgUnitsTable)
    .where(eq(hrOrgUnitsTable.workspaceId, workspaceId));
  const byCode = new Map(existing.filter((e) => e.code).map((e) => [normCode(e.code), e.id]));

  const seen = new Set<string>();
  const out: PreviewRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? {};
    const code = norm(r.code);
    const name = norm(r.name);
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!code) errors.push("code is required");
    if (!name) errors.push("name is required");
    const key = normCode(code);
    if (key && seen.has(key)) errors.push(`duplicate code in file: ${code}`);
    if (key) seen.add(key);

    const type = norm(r.type) || "department";
    const parentCode = norm(r.parent_code);
    const parentId = parentCode ? (byCode.get(normCode(parentCode)) ?? null) : null;
    if (parentCode && !parentId) errors.push(`parent_code "${parentCode}" not found (import parent first)`);

    const displayOrder = intFromCell(r.display_order, 0) ?? 0;
    const isActive = boolFromCell(r.is_active, true);
    const nameAr = norm(r.name_ar) || null;

    const existingId = key ? byCode.get(key) : undefined;
    const action: PreviewAction = errors.length > 0 ? "reject" : existingId ? "update" : "create";

    out.push({
      rowIndex: i + 1,
      action,
      code,
      name,
      errors,
      warnings,
      data: { code, name, nameAr, type, parentCode: parentCode || null, parentId, displayOrder, isActive, existingId: existingId ?? null },
    });
  }
  const summary = {
    total: out.length,
    create: out.filter((x) => x.action === "create").length,
    update: out.filter((x) => x.action === "update").length,
    reject: out.filter((x) => x.action === "reject").length,
    skip: out.filter((x) => x.action === "skip").length,
  };
  return { rows: out, summary };
}

async function previewContractTypes(workspaceId: number, rows: Record<string, unknown>[]): Promise<{ rows: PreviewRow[]; summary: Record<string, number> }> {
  const existing = await db
    .select({ id: hrContractTypesTable.id, code: hrContractTypesTable.code })
    .from(hrContractTypesTable)
    .where(eq(hrContractTypesTable.workspaceId, workspaceId));
  const byCode = new Map(existing.map((e) => [normCode(e.code), e.id]));

  const seen = new Set<string>();
  const out: PreviewRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? {};
    const code = norm(r.code);
    const name = norm(r.name);
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!code) errors.push("code is required");
    if (!name) errors.push("name is required");
    const key = normCode(code);
    if (key && seen.has(key)) errors.push(`duplicate code in file: ${code}`);
    if (key) seen.add(key);

    const nameAr = norm(r.name_ar) || null;
    const color = norm(r.color) || "#6366f1";
    const displayOrder = intFromCell(r.display_order, 0) ?? 0;
    const isActive = boolFromCell(r.is_active, true);
    const existingId = key ? byCode.get(key) : undefined;
    const action: PreviewAction = errors.length > 0 ? "reject" : existingId ? "update" : "create";
    out.push({ rowIndex: i + 1, action, code, name, errors, warnings, data: { code, name, nameAr, color, displayOrder, isActive, existingId: existingId ?? null } });
  }
  const summary = { total: out.length, create: out.filter((x) => x.action === "create").length, update: out.filter((x) => x.action === "update").length, reject: out.filter((x) => x.action === "reject").length, skip: 0 };
  return { rows: out, summary };
}

async function previewDocumentTypes(workspaceId: number, rows: Record<string, unknown>[]): Promise<{ rows: PreviewRow[]; summary: Record<string, number> }> {
  const existing = await db
    .select({ id: hrDocumentTypesTable.id, code: hrDocumentTypesTable.code })
    .from(hrDocumentTypesTable)
    .where(eq(hrDocumentTypesTable.workspaceId, workspaceId));
  const byCode = new Map(existing.filter((e) => e.code).map((e) => [normCode(e.code), e.id]));

  const seen = new Set<string>();
  const out: PreviewRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? {};
    const code = norm(r.code);
    const name = norm(r.name);
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!name) errors.push("name is required");
    if (!code) errors.push("code is required");
    const key = normCode(code);
    if (key && seen.has(key)) errors.push(`duplicate code in file: ${code}`);
    if (key) seen.add(key);

    const nameAr = norm(r.name_ar) || null;
    const hasExpiry = boolFromCell(r.has_expiry, false);
    const isRequired = boolFromCell(r.is_required, false);
    const displayOrder = intFromCell(r.display_order, 0) ?? 0;
    const isActive = boolFromCell(r.is_active, true);
    const existingId = key ? byCode.get(key) : undefined;
    const action: PreviewAction = errors.length > 0 ? "reject" : existingId ? "update" : "create";
    out.push({ rowIndex: i + 1, action, code, name, errors, warnings, data: { code, name, nameAr, hasExpiry, isRequired, displayOrder, isActive, existingId: existingId ?? null } });
  }
  const summary = { total: out.length, create: out.filter((x) => x.action === "create").length, update: out.filter((x) => x.action === "update").length, reject: out.filter((x) => x.action === "reject").length, skip: 0 };
  return { rows: out, summary };
}

async function previewLeavePolicies(workspaceId: number, rows: Record<string, unknown>[]): Promise<{ rows: PreviewRow[]; summary: Record<string, number> }> {
  const existing = await db
    .select({ id: hrLeavePoliciesTable.id, code: hrLeavePoliciesTable.code })
    .from(hrLeavePoliciesTable)
    .where(eq(hrLeavePoliciesTable.workspaceId, workspaceId));
  const byCode = new Map(existing.filter((e) => e.code).map((e) => [normCode(e.code), e.id]));

  const seen = new Set<string>();
  const out: PreviewRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? {};
    const code = norm(r.code);
    const name = norm(r.name);
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!name) errors.push("name is required");
    if (!code) errors.push("code is required");
    const key = normCode(code);
    if (key && seen.has(key)) errors.push(`duplicate code in file: ${code}`);
    if (key) seen.add(key);

    const nameAr = norm(r.name_ar) || null;
    const leaveType = norm(r.leave_type) || "annual";
    const annualDays = intFromCell(r.annual_days, 0) ?? 0;
    const accrualType = norm(r.accrual_type) || "monthly";
    const carryOver = boolFromCell(r.carry_over, false);
    const maxCarryOverDays = intFromCell(r.max_carry_over_days, null);
    const paid = boolFromCell(r.paid, true);
    const requiresApproval = boolFromCell(r.requires_approval, true);
    const displayOrder = intFromCell(r.display_order, 0) ?? 0;
    const isActive = boolFromCell(r.is_active, true);
    const existingId = key ? byCode.get(key) : undefined;
    const action: PreviewAction = errors.length > 0 ? "reject" : existingId ? "update" : "create";
    out.push({
      rowIndex: i + 1,
      action,
      code,
      name,
      errors,
      warnings,
      data: { code, name, nameAr, leaveType, annualDays, accrualType, carryOver, maxCarryOverDays, paid, requiresApproval, displayOrder, isActive, existingId: existingId ?? null },
    });
  }
  const summary = { total: out.length, create: out.filter((x) => x.action === "create").length, update: out.filter((x) => x.action === "update").length, reject: out.filter((x) => x.action === "reject").length, skip: 0 };
  return { rows: out, summary };
}

async function previewProbationPolicies(workspaceId: number, rows: Record<string, unknown>[]): Promise<{ rows: PreviewRow[]; summary: Record<string, number> }> {
  const existing = await db
    .select({ id: hrProbationPoliciesTable.id, name: hrProbationPoliciesTable.name })
    .from(hrProbationPoliciesTable)
    .where(eq(hrProbationPoliciesTable.workspaceId, workspaceId));
  const byName = new Map(existing.map((e) => [normCode(e.name), e.id]));

  const seen = new Set<string>();
  const out: PreviewRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? {};
    const name = norm(r.name);
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!name) errors.push("name is required");
    const key = normCode(name);
    if (key && seen.has(key)) errors.push(`duplicate name in file: ${name}`);
    if (key) seen.add(key);

    const nameAr = norm(r.name_ar) || null;
    const durationDays = intFromCell(r.duration_days, 90) ?? 90;
    const extendable = boolFromCell(r.extendable, false);
    const maxExtensionDays = intFromCell(r.max_extension_days, null);
    const isActive = boolFromCell(r.is_active, true);
    const existingId = key ? byName.get(key) : undefined;
    const action: PreviewAction = errors.length > 0 ? "reject" : existingId ? "update" : "create";
    out.push({ rowIndex: i + 1, action, code: "", name, errors, warnings, data: { name, nameAr, durationDays, extendable, maxExtensionDays, isActive, existingId: existingId ?? null } });
  }
  const summary = { total: out.length, create: out.filter((x) => x.action === "create").length, update: out.filter((x) => x.action === "update").length, reject: out.filter((x) => x.action === "reject").length, skip: 0 };
  return { rows: out, summary };
}

async function previewPositions(workspaceId: number, rows: Record<string, unknown>[]): Promise<{ rows: PreviewRow[]; summary: Record<string, number> }> {
  const [existing, orgs, titles, grades, locations] = await Promise.all([
    db.select({ id: hrPositionsTable.id, code: hrPositionsTable.code }).from(hrPositionsTable).where(eq(hrPositionsTable.workspaceId, workspaceId)),
    db.select({ id: hrOrgUnitsTable.id, code: hrOrgUnitsTable.code }).from(hrOrgUnitsTable).where(eq(hrOrgUnitsTable.workspaceId, workspaceId)),
    db.select({ id: hrJobTitlesTable.id, code: hrJobTitlesTable.code }).from(hrJobTitlesTable).where(eq(hrJobTitlesTable.workspaceId, workspaceId)),
    db.select({ id: hrJobGradesTable.id, code: hrJobGradesTable.code }).from(hrJobGradesTable).where(eq(hrJobGradesTable.workspaceId, workspaceId)),
    db.select({ id: hrWorkLocationsTable.id, code: hrWorkLocationsTable.code }).from(hrWorkLocationsTable).where(eq(hrWorkLocationsTable.workspaceId, workspaceId)),
  ]);
  const byCode = new Map(existing.filter((e) => e.code).map((e) => [normCode(e.code), e.id]));
  const orgByCode = new Map(orgs.filter((x) => x.code).map((x) => [normCode(x.code), x.id]));
  const titleByCode = new Map(titles.filter((x) => x.code).map((x) => [normCode(x.code), x.id]));
  const gradeByCode = new Map(grades.filter((x) => x.code).map((x) => [normCode(x.code), x.id]));
  const locByCode = new Map(locations.filter((x) => x.code).map((x) => [normCode(x.code), x.id]));

  const seen = new Set<string>();
  const out: PreviewRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? {};
    const code = norm(r.code);
    const title = norm(r.title);
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!code) errors.push("code is required");
    if (!title) errors.push("title is required");
    const key = normCode(code);
    if (key && seen.has(key)) errors.push(`duplicate code in file: ${code}`);
    if (key) seen.add(key);

    const status = norm(r.status) || "vacant";
    const headcount = intFromCell(r.headcount, 1) ?? 1;
    const displayOrder = intFromCell(r.display_order, 0) ?? 0;
    const isActive = boolFromCell(r.is_active, true);
    const titleAr = norm(r.title_ar) || null;
    const description = norm(r.description) || null;

    const orgCode = norm(r.org_unit_code);
    const jobTitleCode = norm(r.job_title_code);
    const jobGradeCode = norm(r.job_grade_code);
    const workLocationCode = norm(r.work_location_code);

    const orgUnitId = orgCode ? (orgByCode.get(normCode(orgCode)) ?? null) : null;
    const jobTitleId = jobTitleCode ? (titleByCode.get(normCode(jobTitleCode)) ?? null) : null;
    const jobGradeId = jobGradeCode ? (gradeByCode.get(normCode(jobGradeCode)) ?? null) : null;
    const workLocationId = workLocationCode ? (locByCode.get(normCode(workLocationCode)) ?? null) : null;

    if (orgCode && !orgUnitId) errors.push(`org_unit_code "${orgCode}" not found`);
    if (jobTitleCode && !jobTitleId) errors.push(`job_title_code "${jobTitleCode}" not found`);
    if (jobGradeCode && !jobGradeId) errors.push(`job_grade_code "${jobGradeCode}" not found`);
    if (workLocationCode && !workLocationId) errors.push(`work_location_code "${workLocationCode}" not found`);

    const existingId = key ? byCode.get(key) : undefined;
    const action: PreviewAction = errors.length > 0 ? "reject" : existingId ? "update" : "create";

    out.push({
      rowIndex: i + 1,
      action,
      code,
      name: title,
      errors,
      warnings,
      data: {
        code,
        title,
        titleAr,
        description,
        status,
        headcount,
        displayOrder,
        isActive,
        orgUnitCode: orgCode || null,
        jobTitleCode: jobTitleCode || null,
        jobGradeCode: jobGradeCode || null,
        workLocationCode: workLocationCode || null,
        orgUnitId,
        jobTitleId,
        jobGradeId,
        workLocationId,
        existingId: existingId ?? null,
      },
    });
  }

  const summary = { total: out.length, create: out.filter((x) => x.action === "create").length, update: out.filter((x) => x.action === "update").length, reject: out.filter((x) => x.action === "reject").length, skip: 0 };
  return { rows: out, summary };
}

router.post("/hr/foundation/import/:category/preview", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const category = String(req.params.category ?? "");
  if (!isCategory(category)) { res.status(400).json({ error: "Invalid category" }); return; }

  const rows = Array.isArray(req.body?.rows) ? (req.body.rows as Record<string, unknown>[]) : [];
  if (!rows.length) { res.status(400).json({ error: "rows required" }); return; }

  if (category === "job-grades") {
    res.json(await previewJobGrades(workspaceId, rows));
    return;
  }
  if (category === "job-titles") {
    res.json(await previewJobTitles(workspaceId, rows));
    return;
  }
  if (category === "org-units") {
    res.json(await previewOrgUnits(workspaceId, rows));
    return;
  }
  if (category === "work-locations") {
    res.json(await previewWorkLocations(workspaceId, rows));
    return;
  }
  if (category === "employment-types") {
    res.json(await previewEmploymentTypes(workspaceId, rows));
    return;
  }
  if (category === "employee-statuses") {
    res.json(await previewEmployeeStatuses(workspaceId, rows));
    return;
  }
  if (category === "contract-types") {
    res.json(await previewContractTypes(workspaceId, rows));
    return;
  }
  if (category === "document-types") {
    res.json(await previewDocumentTypes(workspaceId, rows));
    return;
  }
  if (category === "leave-policies") {
    res.json(await previewLeavePolicies(workspaceId, rows));
    return;
  }
  if (category === "probation-policies") {
    res.json(await previewProbationPolicies(workspaceId, rows));
    return;
  }
  res.json(await previewPositions(workspaceId, rows));
});

router.post("/hr/foundation/import/:category/commit", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const category = String(req.params.category ?? "");
  if (!isCategory(category)) { res.status(400).json({ error: "Invalid category" }); return; }

  const preview = Array.isArray(req.body?.rows) ? (req.body.rows as PreviewRow[]) : [];
  if (!preview.length) { res.status(400).json({ error: "rows required" }); return; }
  const rows = preview.filter((r) => r.action === "create" || r.action === "update");

  const result = await db.transaction(async (tx) => {
    let created = 0;
    let updated = 0;
    const rejected = preview.filter((r) => r.action === "reject").length;

    if (category === "job-grades") {
      for (const r of rows) {
        const d = r.data as any;
        if (r.action === "update" && d.existingId) {
          await tx.update(hrJobGradesTable).set({
            name: d.name,
            nameAr: d.nameAr,
            code: d.code,
            level: d.level,
            description: d.description,
            displayOrder: d.displayOrder ?? 0,
          }).where(and(eq(hrJobGradesTable.workspaceId, workspaceId), eq(hrJobGradesTable.id, Number(d.existingId))));
          updated++;
        } else {
          await tx.insert(hrJobGradesTable).values({
            workspaceId,
            name: d.name,
            nameAr: d.nameAr,
            code: d.code,
            level: d.level,
            description: d.description,
            displayOrder: d.displayOrder ?? 0,
          });
          created++;
        }
      }
      return { created, updated, rejected };
    }

    if (category === "job-titles") {
      for (const r of rows) {
        const d = r.data as any;
        if (r.action === "update" && d.existingId) {
          await tx.update(hrJobTitlesTable).set({
            name: d.name,
            nameAr: d.nameAr,
            code: d.code,
            gradeId: d.gradeId ? Number(d.gradeId) : null,
            description: d.description,
            displayOrder: d.displayOrder ?? 0,
          }).where(and(eq(hrJobTitlesTable.workspaceId, workspaceId), eq(hrJobTitlesTable.id, Number(d.existingId))));
          updated++;
        } else {
          await tx.insert(hrJobTitlesTable).values({
            workspaceId,
            name: d.name,
            nameAr: d.nameAr,
            code: d.code,
            gradeId: d.gradeId ? Number(d.gradeId) : null,
            description: d.description,
            displayOrder: d.displayOrder ?? 0,
          });
          created++;
        }
      }
      return { created, updated, rejected };
    }

    if (category === "work-locations") {
      const existing = await tx
        .select({ id: hrWorkLocationsTable.id, code: hrWorkLocationsTable.code })
        .from(hrWorkLocationsTable)
        .where(eq(hrWorkLocationsTable.workspaceId, workspaceId));
      const byCode = new Map(existing.filter((e) => e.code).map((e) => [normCode(e.code), e.id]));

      for (const r of rows) {
        const d = r.data as any;
        const existingId = d.existingId ? Number(d.existingId) : (d.code ? (byCode.get(normCode(d.code)) ?? null) : null);
        if (r.action === "update" && existingId) {
          await tx.update(hrWorkLocationsTable).set({
            name: d.name,
            nameAr: d.nameAr,
            code: d.code,
            type: d.type ?? "office",
            address: d.address,
            city: d.city,
            country: d.country,
            timezone: d.timezone,
            displayOrder: d.displayOrder ?? 0,
            isActive: d.isActive ?? true,
          }).where(and(eq(hrWorkLocationsTable.workspaceId, workspaceId), eq(hrWorkLocationsTable.id, existingId)));
          updated++;
        } else {
          await tx.insert(hrWorkLocationsTable).values({
            workspaceId,
            name: d.name,
            nameAr: d.nameAr,
            code: d.code,
            type: d.type ?? "office",
            address: d.address,
            city: d.city,
            country: d.country,
            timezone: d.timezone,
            displayOrder: d.displayOrder ?? 0,
            isActive: d.isActive ?? true,
          });
          created++;
        }
      }
      return { created, updated, rejected };
    }

    if (category === "employment-types") {
      const existing = await tx
        .select({ id: hrEmploymentTypesTable.id, code: hrEmploymentTypesTable.code })
        .from(hrEmploymentTypesTable)
        .where(eq(hrEmploymentTypesTable.workspaceId, workspaceId));
      const byCode = new Map(existing.filter((e) => e.code).map((e) => [normCode(e.code), e.id]));

      for (const r of rows) {
        const d = r.data as any;
        const existingId = d.existingId ? Number(d.existingId) : (d.code ? (byCode.get(normCode(d.code)) ?? null) : null);
        if (r.action === "update" && existingId) {
          await tx.update(hrEmploymentTypesTable).set({
            code: d.code,
            name: d.name,
            nameAr: d.nameAr,
            color: d.color ?? "#6366f1",
            displayOrder: d.displayOrder ?? 0,
            isActive: d.isActive ?? true,
          }).where(and(eq(hrEmploymentTypesTable.workspaceId, workspaceId), eq(hrEmploymentTypesTable.id, existingId)));
          updated++;
        } else {
          await tx.insert(hrEmploymentTypesTable).values({
            workspaceId,
            code: d.code,
            name: d.name,
            nameAr: d.nameAr,
            color: d.color ?? "#6366f1",
            displayOrder: d.displayOrder ?? 0,
            isActive: d.isActive ?? true,
          });
          created++;
        }
      }
      return { created, updated, rejected };
    }

    if (category === "employee-statuses") {
      const existing = await tx
        .select({ id: hrEmployeeStatusesTable.id, code: hrEmployeeStatusesTable.code })
        .from(hrEmployeeStatusesTable)
        .where(eq(hrEmployeeStatusesTable.workspaceId, workspaceId));
      const byCode = new Map(existing.filter((e) => e.code).map((e) => [normCode(e.code), e.id]));

      for (const r of rows) {
        const d = r.data as any;
        const existingId = d.existingId ? Number(d.existingId) : (d.code ? (byCode.get(normCode(d.code)) ?? null) : null);
        if (r.action === "update" && existingId) {
          await tx.update(hrEmployeeStatusesTable).set({
            code: d.code,
            name: d.name,
            nameAr: d.nameAr,
            color: d.color ?? "#6366f1",
            isDefault: d.isDefault ?? false,
            isFinal: d.isFinal ?? false,
            allowSelfService: d.allowSelfService ?? false,
            displayOrder: d.displayOrder ?? 0,
            isActive: d.isActive ?? true,
          }).where(and(eq(hrEmployeeStatusesTable.workspaceId, workspaceId), eq(hrEmployeeStatusesTable.id, existingId)));
          updated++;
        } else {
          await tx.insert(hrEmployeeStatusesTable).values({
            workspaceId,
            code: d.code,
            name: d.name,
            nameAr: d.nameAr,
            color: d.color ?? "#6366f1",
            isDefault: d.isDefault ?? false,
            isFinal: d.isFinal ?? false,
            allowSelfService: d.allowSelfService ?? false,
            displayOrder: d.displayOrder ?? 0,
            isActive: d.isActive ?? true,
          });
          created++;
        }
      }
      return { created, updated, rejected };
    }

    if (category === "contract-types") {
      for (const r of rows) {
        const d = r.data as any;
        if (r.action === "update" && d.existingId) {
          await tx.update(hrContractTypesTable).set({
            code: d.code,
            name: d.name,
            nameAr: d.nameAr,
            color: d.color ?? "#6366f1",
            displayOrder: d.displayOrder ?? 0,
            isActive: d.isActive ?? true,
          }).where(and(eq(hrContractTypesTable.workspaceId, workspaceId), eq(hrContractTypesTable.id, Number(d.existingId))));
          updated++;
        } else {
          await tx.insert(hrContractTypesTable).values({
            workspaceId,
            code: d.code,
            name: d.name,
            nameAr: d.nameAr,
            color: d.color ?? "#6366f1",
            displayOrder: d.displayOrder ?? 0,
            isActive: d.isActive ?? true,
          });
          created++;
        }
      }
      return { created, updated, rejected };
    }

    if (category === "document-types") {
      // updates by existingId; creates by code match if preview had it
      for (const r of rows) {
        const d = r.data as any;
        if (r.action === "update" && d.existingId) {
          await tx.update(hrDocumentTypesTable).set({
            code: d.code,
            name: d.name,
            nameAr: d.nameAr,
            hasExpiry: d.hasExpiry ?? false,
            isRequired: d.isRequired ?? false,
            displayOrder: d.displayOrder ?? 0,
            isActive: d.isActive ?? true,
          }).where(and(eq(hrDocumentTypesTable.workspaceId, workspaceId), eq(hrDocumentTypesTable.id, Number(d.existingId))));
          updated++;
        } else {
          await tx.insert(hrDocumentTypesTable).values({
            workspaceId,
            code: d.code,
            name: d.name,
            nameAr: d.nameAr,
            hasExpiry: d.hasExpiry ?? false,
            isRequired: d.isRequired ?? false,
            displayOrder: d.displayOrder ?? 0,
            isActive: d.isActive ?? true,
          });
          created++;
        }
      }
      return { created, updated, rejected };
    }

    if (category === "leave-policies") {
      for (const r of rows) {
        const d = r.data as any;
        if (r.action === "update" && d.existingId) {
          await tx.update(hrLeavePoliciesTable).set({
            code: d.code,
            name: d.name,
            nameAr: d.nameAr,
            leaveType: d.leaveType ?? "annual",
            annualDays: Number(d.annualDays ?? 0),
            accrualType: d.accrualType ?? "monthly",
            carryOver: d.carryOver ?? false,
            maxCarryOverDays: d.maxCarryOverDays ?? null,
            paid: d.paid ?? true,
            requiresApproval: d.requiresApproval ?? true,
            displayOrder: d.displayOrder ?? 0,
            isActive: d.isActive ?? true,
          }).where(and(eq(hrLeavePoliciesTable.workspaceId, workspaceId), eq(hrLeavePoliciesTable.id, Number(d.existingId))));
          updated++;
        } else {
          await tx.insert(hrLeavePoliciesTable).values({
            workspaceId,
            code: d.code,
            name: d.name,
            nameAr: d.nameAr,
            leaveType: d.leaveType ?? "annual",
            annualDays: Number(d.annualDays ?? 0),
            accrualType: d.accrualType ?? "monthly",
            carryOver: d.carryOver ?? false,
            maxCarryOverDays: d.maxCarryOverDays ?? null,
            paid: d.paid ?? true,
            requiresApproval: d.requiresApproval ?? true,
            displayOrder: d.displayOrder ?? 0,
            isActive: d.isActive ?? true,
          });
          created++;
        }
      }
      return { created, updated, rejected };
    }

    if (category === "probation-policies") {
      for (const r of rows) {
        const d = r.data as any;
        if (r.action === "update" && d.existingId) {
          await tx.update(hrProbationPoliciesTable).set({
            name: d.name,
            nameAr: d.nameAr,
            durationDays: Number(d.durationDays ?? 90),
            extendable: d.extendable ?? false,
            maxExtensionDays: d.maxExtensionDays ?? null,
            isActive: d.isActive ?? true,
          }).where(and(eq(hrProbationPoliciesTable.workspaceId, workspaceId), eq(hrProbationPoliciesTable.id, Number(d.existingId))));
          updated++;
        } else {
          await tx.insert(hrProbationPoliciesTable).values({
            workspaceId,
            name: d.name,
            nameAr: d.nameAr,
            durationDays: Number(d.durationDays ?? 90),
            extendable: d.extendable ?? false,
            maxExtensionDays: d.maxExtensionDays ?? null,
            isActive: d.isActive ?? true,
          });
          created++;
        }
      }
      return { created, updated, rejected };
    }

    if (category === "positions") {
      const existing = await tx
        .select({ id: hrPositionsTable.id, code: hrPositionsTable.code })
        .from(hrPositionsTable)
        .where(eq(hrPositionsTable.workspaceId, workspaceId));
      const byCode = new Map(existing.filter((e) => e.code).map((e) => [normCode(e.code), e.id]));

      for (const r of rows) {
        const d = r.data as any;
        const existingId = d.existingId ? Number(d.existingId) : (d.code ? (byCode.get(normCode(d.code)) ?? null) : null);
        if (r.action === "update" && existingId) {
          await tx.update(hrPositionsTable).set({
            code: d.code,
            title: d.title,
            titleAr: d.titleAr,
            description: d.description,
            status: d.status ?? "vacant",
            headcount: Number(d.headcount ?? 1),
            displayOrder: d.displayOrder ?? 0,
            isActive: d.isActive ?? true,
            orgUnitId: d.orgUnitId ? Number(d.orgUnitId) : null,
            jobTitleId: d.jobTitleId ? Number(d.jobTitleId) : null,
            jobGradeId: d.jobGradeId ? Number(d.jobGradeId) : null,
            workLocationId: d.workLocationId ? Number(d.workLocationId) : null,
          }).where(and(eq(hrPositionsTable.workspaceId, workspaceId), eq(hrPositionsTable.id, existingId)));
          updated++;
        } else {
          await tx.insert(hrPositionsTable).values({
            workspaceId,
            code: d.code,
            title: d.title,
            titleAr: d.titleAr,
            description: d.description,
            status: d.status ?? "vacant",
            headcount: Number(d.headcount ?? 1),
            displayOrder: d.displayOrder ?? 0,
            isActive: d.isActive ?? true,
            orgUnitId: d.orgUnitId ? Number(d.orgUnitId) : null,
            jobTitleId: d.jobTitleId ? Number(d.jobTitleId) : null,
            jobGradeId: d.jobGradeId ? Number(d.jobGradeId) : null,
            workLocationId: d.workLocationId ? Number(d.workLocationId) : null,
          });
          created++;
        }
      }
      return { created, updated, rejected };
    }

    // org units: two-pass commit (insert first, then set parentId based on codes)
    // Pass 1: upsert base fields without parentId.
    const existing = await tx
      .select({ id: hrOrgUnitsTable.id, code: hrOrgUnitsTable.code })
      .from(hrOrgUnitsTable)
      .where(eq(hrOrgUnitsTable.workspaceId, workspaceId));
    const byCode = new Map(existing.filter((e) => e.code).map((e) => [normCode(e.code), e.id]));

    for (const r of rows) {
      const d = r.data as any;
      if (r.action === "update" && d.existingId) {
        await tx.update(hrOrgUnitsTable).set({
          name: d.name,
          nameAr: d.nameAr,
          code: d.code,
          type: d.type ?? "department",
          displayOrder: d.displayOrder ?? 0,
          isActive: d.isActive ?? true,
        }).where(and(eq(hrOrgUnitsTable.workspaceId, workspaceId), eq(hrOrgUnitsTable.id, Number(d.existingId))));
        updated++;
      } else {
        const [ins] = await tx.insert(hrOrgUnitsTable).values({
          workspaceId,
          name: d.name,
          nameAr: d.nameAr,
          code: d.code,
          type: d.type ?? "department",
          displayOrder: d.displayOrder ?? 0,
          isActive: d.isActive ?? true,
        }).returning({ id: hrOrgUnitsTable.id });
        created++;
        if (d.code && ins?.id) byCode.set(normCode(d.code), ins.id);
      }
    }

    // Pass 2: apply parent_code → parentId for all affected rows (including updates).
    for (const r of rows) {
      const d = r.data as any;
      const myId = d.existingId ? Number(d.existingId) : (d.code ? byCode.get(normCode(d.code)) : null);
      if (!myId) continue;
      const parentId = d.parentCode ? (byCode.get(normCode(d.parentCode)) ?? null) : null;
      await tx.update(hrOrgUnitsTable).set({ parentId }).where(and(eq(hrOrgUnitsTable.workspaceId, workspaceId), eq(hrOrgUnitsTable.id, myId)));
    }

    return { created, updated, rejected };
  });

  res.json({ ok: true, ...result });
});

export default router;

