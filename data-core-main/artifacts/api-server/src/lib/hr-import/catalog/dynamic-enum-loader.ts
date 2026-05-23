/**
 * Dynamic enum loaders — DB-first with hardcoded fallback (backward compatible).
 */

import { db, hrEmployeeStatusesTable, hrEmploymentTypesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { normalizeRuntimeKey } from "../normalization";

/** Hardcoded fallback sets (legacy import compatibility). */
export const FALLBACK_EMPLOYMENT_TYPES = [
  "full_time",
  "part_time",
  "contractor",
  "intern",
  "temporary",
] as const;

export const FALLBACK_EMPLOYEE_STATUSES = [
  "active",
  "on_leave",
  "suspended",
  "terminated",
  "resigned",
] as const;

export type DynamicEnumLoadResult = {
  codes: Set<string>;
  source: "dynamic" | "fallback" | "merged";
  items: Array<{ code: string; name: string; nameAr?: string | null }>;
};

export async function loadDynamicEmploymentTypes(workspaceId: number): Promise<DynamicEnumLoadResult> {
  try {
    const rows = await db
      .select({
        code: hrEmploymentTypesTable.code,
        name: hrEmploymentTypesTable.name,
        nameAr: hrEmploymentTypesTable.nameAr,
      })
      .from(hrEmploymentTypesTable)
      .where(
        and(
          eq(hrEmploymentTypesTable.workspaceId, workspaceId),
          eq(hrEmploymentTypesTable.isActive, true),
        ),
      );

    const codes = new Set<string>(FALLBACK_EMPLOYMENT_TYPES);
    const items = rows.map((r) => ({ code: r.code, name: r.name, nameAr: r.nameAr }));

    for (const r of rows) {
      if (r.code) codes.add(normalizeRuntimeKey(r.code) || r.code);
      codes.add(r.code);
    }

    return {
      codes,
      source: rows.length ? "merged" : "fallback",
      items,
    };
  } catch {
    return {
      codes: new Set(FALLBACK_EMPLOYMENT_TYPES),
      source: "fallback",
      items: [],
    };
  }
}

export async function loadDynamicEmployeeStatuses(workspaceId: number): Promise<DynamicEnumLoadResult> {
  try {
    const rows = await db
      .select({
        code: hrEmployeeStatusesTable.code,
        name: hrEmployeeStatusesTable.name,
        nameAr: hrEmployeeStatusesTable.nameAr,
      })
      .from(hrEmployeeStatusesTable)
      .where(
        and(
          eq(hrEmployeeStatusesTable.workspaceId, workspaceId),
          eq(hrEmployeeStatusesTable.isActive, true),
        ),
      );

    const codes = new Set<string>(FALLBACK_EMPLOYEE_STATUSES);
    const items = rows.map((r) => ({ code: r.code, name: r.name, nameAr: r.nameAr }));

    for (const r of rows) {
      if (r.code) {
        codes.add(r.code);
        codes.add(normalizeRuntimeKey(r.code) || r.code);
      }
    }

    return {
      codes,
      source: rows.length ? "merged" : "fallback",
      items,
    };
  } catch {
    return {
      codes: new Set(FALLBACK_EMPLOYEE_STATUSES),
      source: "fallback",
      items: [],
    };
  }
}

/** Validate value against dynamic set; empty values pass. */
export function isAllowedEnumValue(value: string, allowed: Set<string>): boolean {
  if (!value) return true;
  const normalized = normalizeRuntimeKey(value);
  return allowed.has(value) || allowed.has(normalized);
}
