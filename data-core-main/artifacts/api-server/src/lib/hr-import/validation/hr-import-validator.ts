/**
 * Phase 2 — HrImportValidator (catalog-driven, read-only validation).
 */

import type { MasterDataCatalogSnapshot } from "../catalog/master-data-catalog";
import { isValidCustomFieldDropdownValue } from "../catalog/master-data-catalog";
import { loadDynamicEmploymentTypes, loadDynamicEmployeeStatuses, isAllowedEnumValue } from "../catalog/dynamic-enum-loader";
import { resolveEmployeeImportLookups } from "../mapping/mapping-foundation";
import {
  getFieldFromRow,
  validateDateField,
  validateEmailField,
} from "../validation/import-validation-foundation";
import {
  validateEmployeeRowCanonical,
  type CanonicalImportModes,
} from "./canonical-import-gates";

export type HrImportValidatorContext = {
  workspaceId: number;
  catalog: MasterDataCatalogSnapshot;
  numberingMode: string;
  employmentTypes?: Awaited<ReturnType<typeof loadDynamicEmploymentTypes>>;
  employeeStatuses?: Awaited<ReturnType<typeof loadDynamicEmployeeStatuses>>;
  canonicalModes?: CanonicalImportModes;
};

export type HrImportRowValidation = {
  rowIndex: number;
  errors: string[];
  warnings: string[];
  resolved: Record<string, unknown>;
};

const VALID_GENDERS = new Set(["male", "female", "other", "prefer_not_to_say"]);

export class HrImportValidator {
  static async createContext(workspaceId: number, catalog: MasterDataCatalogSnapshot, numberingMode: string): Promise<HrImportValidatorContext> {
    const [employmentTypes, employeeStatuses] = await Promise.all([
      loadDynamicEmploymentTypes(workspaceId),
      loadDynamicEmployeeStatuses(workspaceId),
    ]);
    return { workspaceId, catalog, numberingMode, employmentTypes, employeeStatuses };
  }

  static validateRow(ctx: HrImportValidatorContext, row: Record<string, string>, rowIndex: number): HrImportRowValidation {
    const errors: string[] = [];
    const warnings: string[] = [];

    const fullName = getFieldFromRow(row, "full_name", "الاسم الكامل", "Full Name");
    const email = getFieldFromRow(row, "email", "البريد الإلكتروني", "Email");
    const empNum = getFieldFromRow(row, "employee_number", "رقم الموظف", "Employee Number");
    const empType = getFieldFromRow(row, "employment_type", "نوع التوظيف", "Employment Type");
    const status = getFieldFromRow(row, "status", "الحالة", "Status");
    const gender = getFieldFromRow(row, "gender", "الجنس", "Gender");

    if (!fullName) errors.push("full_name is required");
    if (ctx.numberingMode === "manual" && !empNum) errors.push("employee_number is required (manual mode)");

    const emailErr = validateEmailField(email);
    if (emailErr) errors.push(emailErr);

    if (empType && ctx.employmentTypes && !isAllowedEnumValue(empType, ctx.employmentTypes.codes)) {
      errors.push(`Invalid employment_type: "${empType}"`);
    }
    if (status && ctx.employeeStatuses && !isAllowedEnumValue(status, ctx.employeeStatuses.codes)) {
      errors.push(`Invalid status: "${status}"`);
    }
    if (gender && !VALID_GENDERS.has(gender)) warnings.push(`Non-standard gender: "${gender}"`);

    for (const [lbl, val] of [
      ["hire_date", getFieldFromRow(row, "hire_date")],
      ["end_date", getFieldFromRow(row, "end_date")],
      ["probation_end_date", getFieldFromRow(row, "probation_end_date")],
      ["date_of_birth", getFieldFromRow(row, "date_of_birth")],
    ] as [string, string][]) {
      const dErr = validateDateField(val, lbl);
      if (dErr) errors.push(dErr);
    }

    const mapping = resolveEmployeeImportLookups(ctx.catalog, {
      orgUnitName: getFieldFromRow(row, "org_unit_name", "الوحدة التنظيمية"),
      jobTitleName: getFieldFromRow(row, "job_title_name", "المسمى الوظيفي"),
      jobGradeName: getFieldFromRow(row, "job_grade_name", "الدرجة الوظيفية"),
      positionTitle: getFieldFromRow(row, "position_title", "المنصب"),
      workLocationName: getFieldFromRow(row, "work_location", "موقع العمل"),
    });

    for (const r of mapping.resolutions) {
      if (r.inputValue && !r.resolved) {
        warnings.push(`${r.entityType} "${r.inputValue}" not found in catalog`);
      }
    }

    for (const cf of ctx.catalog.customFieldDropdowns) {
      const val = getFieldFromRow(row, `cf_${cf.fieldName}`, cf.fieldName);
      if (val && !isValidCustomFieldDropdownValue(cf, val)) {
        warnings.push(`custom field "${cf.fieldName}" value "${val}" not in dropdown options`);
      }
    }

    if (ctx.canonicalModes) {
      const canon = validateEmployeeRowCanonical(row, ctx.canonicalModes);
      errors.push(...canon.errors);
      warnings.push(...canon.warnings);
    }

    return {
      rowIndex,
      errors,
      warnings,
      resolved: {
        orgUnitId: mapping.resolutions[0]?.resolvedId ?? null,
        jobTitleId: mapping.resolutions[1]?.resolvedId ?? null,
        jobGradeId: mapping.resolutions[2]?.resolvedId ?? null,
        positionId: mapping.resolutions[3]?.resolvedId ?? null,
        workLocationId: mapping.resolutions[4]?.resolvedId ?? null,
      },
    };
  }

  static validateRows(ctx: HrImportValidatorContext, rows: Record<string, string>[]): HrImportRowValidation[] {
    return rows.map((row, i) => HrImportValidator.validateRow(ctx, row, i + 1));
  }
}
