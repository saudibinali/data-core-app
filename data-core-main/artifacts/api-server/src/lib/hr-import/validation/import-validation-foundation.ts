/**
 * Shared validation foundation (Phase 1 — helpers only, no business enforcement).
 */

import { normalizeName, normalizeRuntimeKey } from "../normalization";
import { isAllowedEnumValue, type DynamicEnumLoadResult } from "../catalog/dynamic-enum-loader";
import type { ImportValidationMode } from "../runtime-settings";

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type RowValidationContext = {
  validationMode: ImportValidationMode;
  employmentTypes: DynamicEnumLoadResult;
  employeeStatuses: DynamicEnumLoadResult;
};

export type RowValidationResult = {
  errors: string[];
  warnings: string[];
  normalized: Record<string, string>;
};

export function validateEmailField(value: string): string | null {
  if (!value) return null;
  return EMAIL_RE.test(value) ? null : "Invalid email format";
}

export function validateDateField(value: string, label: string): string | null {
  if (!value) return null;
  return DATE_RE.test(value) ? null : `Invalid ${label} format (use YYYY-MM-DD)`;
}

export function validateEmploymentType(value: string, ctx: RowValidationContext): string | null {
  if (!value) return null;
  if (isAllowedEnumValue(value, ctx.employmentTypes.codes)) return null;
  return `Invalid employment_type "${value}"`;
}

export function validateEmployeeStatus(value: string, ctx: RowValidationContext): string | null {
  if (!value) return null;
  if (isAllowedEnumValue(value, ctx.employeeStatuses.codes)) return null;
  return `Invalid status "${value}"`;
}

/** Normalize raw import row keys to canonical snake_case keys where possible. */
export function normalizeImportRowKeys(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    const key = normalizeRuntimeKey(k.replace(/\s+/g, "_")) || k.trim();
    out[key] = String(v ?? "").trim();
  }
  return out;
}

export function getFieldFromRow(row: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== "") return String(row[k]).trim();
  }
  for (const k of keys) {
    const nk = normalizeRuntimeKey(k);
    if (row[nk] !== undefined && row[nk] !== "") return String(row[nk]).trim();
  }
  return "";
}

/** Shadow-mode diff: compare hardcoded-only vs merged dynamic validation outcome. */
export function shadowEnumValidationDiff(
  value: string,
  hardcoded: Set<string>,
  dynamic: Set<string>,
): { hardcodedOk: boolean; dynamicOk: boolean; mismatch: boolean } {
  if (!value) return { hardcodedOk: true, dynamicOk: true, mismatch: false };
  const hv = hardcoded.has(value) || hardcoded.has(normalizeRuntimeKey(value));
  const dv = dynamic.has(value) || dynamic.has(normalizeRuntimeKey(value));
  return { hardcodedOk: hv, dynamicOk: dv, mismatch: hv !== dv };
}

export function normalizeDisplayName(value: string): string {
  return normalizeName(value);
}
