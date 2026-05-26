/**
 * F5.4 — Reject import rows that violate workforce canonical model (org / leave).
 */

import type { OrgRuntimeMode } from "../../workforce/org/org-runtime-settings";
import type { LeaveRuntimeMode } from "../../hr/hcm-workspace-settings";
import { getFieldFromRow, normalizeImportRowKeys } from "./import-validation-foundation";

export type CanonicalImportModes = {
  orgRuntimeMode: OrgRuntimeMode;
  leaveRuntimeMode: LeaveRuntimeMode;
};

const LEGACY_DEPARTMENT_KEYS = [
  "department_name",
  "department",
  "department_id",
  "dept_name",
  "legacy_department",
  "user_department",
];

const LEGACY_LEAVE_KEYS = [
  "leave_days",
  "leave_balance",
  "leave_balance_days",
  "legacy_leave",
  "employee_leave_days",
  "hr_employee_leave",
  "leave_request_legacy",
];

const FORBIDDEN_MASTER_ENTITY_TYPES = new Set([
  "legacy_department",
  "departments",
  "user_department",
  "hr_employee_leave",
  "employee_leave",
  "leave_legacy",
  "leave_request_legacy",
]);

function rowHasAnyKey(row: Record<string, string>, keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && String(v).trim() !== "") return k;
  }
  return null;
}

export function validateEmployeeRowCanonical(
  row: Record<string, string>,
  modes: CanonicalImportModes,
): { errors: string[]; warnings: string[] } {
  const normalized = normalizeImportRowKeys(row);
  const errors: string[] = [];
  const warnings: string[] = [];

  const legacyDeptKey = rowHasAnyKey(normalized, LEGACY_DEPARTMENT_KEYS);
  const legacyLeaveKey = rowHasAnyKey(normalized, LEGACY_LEAVE_KEYS);
  const orgUnit = getFieldFromRow(normalized, "org_unit_name", "org_unit", "الوحدة التنظيمية");

  if (modes.orgRuntimeMode === "active") {
    if (legacyDeptKey) {
      errors.push(
        `Legacy department field "${legacyDeptKey}" is not allowed when orgRuntimeMode=active — use org_unit_name`,
      );
    }
    if (!orgUnit) {
      errors.push("org_unit_name is required when org runtime is active (canonical org model)");
    }
  } else if (modes.orgRuntimeMode === "shadow") {
    if (legacyDeptKey) {
      warnings.push(
        `Legacy department field "${legacyDeptKey}" should migrate to org_unit_name before org cutover`,
      );
    }
  }

  if (modes.leaveRuntimeMode === "canonical") {
    if (legacyLeaveKey) {
      errors.push(
        `Legacy leave field "${legacyLeaveKey}" is not allowed when leaveRuntimeMode=canonical — use leave_requests API`,
      );
    }
  } else if (modes.leaveRuntimeMode === "transition" && legacyLeaveKey) {
    warnings.push(
      `Legacy leave field "${legacyLeaveKey}" will be ignored after leave canonical cutover`,
    );
  }

  return { errors, warnings };
}

export function validateMasterDataRowCanonical(
  entityType: string,
  modes: CanonicalImportModes,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const key = entityType.trim().toLowerCase().replace(/\s+/g, "_");

  if (FORBIDDEN_MASTER_ENTITY_TYPES.has(key)) {
    errors.push(`entity_type "${entityType}" targets a legacy surface — not allowed in canonical import`);
    return { errors, warnings };
  }

  if (key === "department" && modes.orgRuntimeMode === "active") {
    warnings.push('entity_type "department" is normalized to org_unit — prefer entity_type org_unit');
  }

  if (modes.orgRuntimeMode === "active" && (key === "legacy_department" || key === "departments")) {
    errors.push("Cannot import legacy departments when orgRuntimeMode=active");
  }

  return { errors, warnings };
}
