import { db } from "@workspace/db";
import {
  employeesTable,
  hrShiftsTable,
  hrAttendanceTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { ParsedImportRow } from "./import-parser";
import {
  validatePunchSequence,
  detectNightShift,
  validateStatus,
  mapLegacySourceType,
} from "./normalization-rules";

export type ValidatedImportRow = {
  rowNumber: number;
  raw: Record<string, string>;
  employeeNumber?: string;
  employeeId?: number;
  employeeName?: string;
  date?: string;
  checkIn?: string;
  checkOut?: string;
  status?: string;
  shiftId?: number;
  shiftName?: string;
  overtimeMinutes?: number;
  lateMinutes?: number;
  earlyLeaveMinutes?: number;
  sourceType?: string;
  notes?: string;
  errors: string[];
  warnings: string[];
  normalizationWarnings: string[];
  isNew: boolean;
  fileDuplicate: boolean;
};

const TIME_RE = /^\d{1,2}:\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_SOURCES = new Set(["manual", "biometric", "mobile", "system", "excel"]);

export async function validateImportRows(
  workspaceId: number,
  parsed: ParsedImportRow[],
): Promise<{ rows: ValidatedImportRow[]; stats: ImportValidationStats }> {
  const empRows = await db
    .select({
      id: employeesTable.id,
      number: employeesTable.employeeNumber,
      name: employeesTable.fullName,
    })
    .from(employeesTable)
    .where(eq(employeesTable.workspaceId, workspaceId));
  const empByNumber = new Map(empRows.map((e) => [String(e.number ?? "").toLowerCase(), e]));

  const shiftRows = await db
    .select({ id: hrShiftsTable.id, name: hrShiftsTable.name })
    .from(hrShiftsTable)
    .where(eq(hrShiftsTable.workspaceId, workspaceId));
  const shiftByName = new Map(shiftRows.map((s) => [String(s.name).toLowerCase(), s]));

  const existingAtt = await db
    .select({ employeeId: hrAttendanceTable.employeeId, date: hrAttendanceTable.date })
    .from(hrAttendanceTable)
    .where(eq(hrAttendanceTable.workspaceId, workspaceId));
  const existingSet = new Set(existingAtt.map((a) => `${a.employeeId}__${a.date}`));

  const fileDupSet = new Set<string>();
  const result: ValidatedImportRow[] = [];

  for (const row of parsed) {
    const m = row.mapped;
    const errors: string[] = [];
    const warnings: string[] = [];
    const normalizationWarnings: string[] = [];

    const empNum = m.employeeNumber ?? "";
    const dateStr = m.date ?? "";
    const status = m.status || "present";
    const checkIn = m.checkIn ?? "";
    const checkOut = m.checkOut ?? "";
    const shiftNm = m.shiftName ?? "";
    const srcType = mapLegacySourceType(m.sourceType);

    if (!empNum) errors.push("employee_number is required");
    if (!dateStr) errors.push("date is required");
    else if (!DATE_RE.test(dateStr)) errors.push(`Invalid date: ${dateStr}`);
    if (status && !validateStatus(status)) errors.push(`Invalid status: ${status}`);
    if (checkIn && !TIME_RE.test(checkIn)) errors.push(`Invalid check_in: ${checkIn}`);
    if (checkOut && !TIME_RE.test(checkOut)) errors.push(`Invalid check_out: ${checkOut}`);
    if (m.sourceType && !VALID_SOURCES.has(m.sourceType.toLowerCase())) {
      warnings.push(`Unknown source_type "${m.sourceType}", will use excel`);
    }

    const matchedEmp = empByNumber.get(empNum.toLowerCase());
    if (empNum && !matchedEmp) errors.push(`Employee not found: ${empNum}`);

    let shiftId: number | undefined;
    if (shiftNm) {
      const sh = shiftByName.get(shiftNm.toLowerCase());
      if (sh) shiftId = sh.id;
      else warnings.push(`Shift not found: ${shiftNm}`);
    }

    const fileKey = `${empNum.toLowerCase()}__${dateStr}`;
    let fileDuplicate = false;
    if (empNum && dateStr && fileDupSet.has(fileKey)) {
      fileDuplicate = true;
      warnings.push("Duplicate row in file (last wins on confirm)");
    }
    if (empNum && dateStr) fileDupSet.add(fileKey);

    const punchIssues = validatePunchSequence(checkIn || null, checkOut || null, {
      allowNightShift: checkIn && checkOut ? detectNightShift(checkIn, checkOut) : false,
    });
    for (const pi of punchIssues) {
      if (pi.code === "invalid_sequence") errors.push(pi.message);
      else normalizationWarnings.push(pi.message);
    }
    if (checkIn && checkOut && detectNightShift(checkIn, checkOut)) {
      normalizationWarnings.push("Night shift detected (check_out after midnight)");
    }

    const isNew =
      !matchedEmp || !dateStr ? true : !existingSet.has(`${matchedEmp.id}__${dateStr}`);

    if (!isNew) warnings.push("Record exists in hr_attendance — will update on confirm");

    result.push({
      rowNumber: row.rowNumber,
      raw: row.raw,
      employeeNumber: empNum || undefined,
      employeeId: matchedEmp?.id,
      employeeName: matchedEmp?.name ?? undefined,
      date: DATE_RE.test(dateStr) ? dateStr : undefined,
      checkIn: checkIn || undefined,
      checkOut: checkOut || undefined,
      status: validateStatus(status) ? status : "present",
      shiftId,
      shiftName: shiftNm || undefined,
      overtimeMinutes: m.overtimeMinutes ? parseInt(m.overtimeMinutes, 10) : 0,
      lateMinutes: m.lateMinutes ? parseInt(m.lateMinutes, 10) : 0,
      earlyLeaveMinutes: m.earlyLeaveMinutes ? parseInt(m.earlyLeaveMinutes, 10) : 0,
      sourceType: srcType === "excel" ? "excel" : m.sourceType || "manual",
      notes: m.notes || undefined,
      errors,
      warnings,
      normalizationWarnings,
      isNew,
      fileDuplicate,
    });
  }

  const stats = buildStats(result);
  return { rows: result, stats };
}

export type ImportValidationStats = {
  total: number;
  valid: number;
  invalid: number;
  warnings: number;
  duplicatesInFile: number;
  newRecords: number;
  updateRecords: number;
  unknownEmployees: number;
  missingPunchWarnings: number;
};

function buildStats(rows: ValidatedImportRow[]): ImportValidationStats {
  const validRows = rows.filter((r) => r.errors.length === 0);
  return {
    total: rows.length,
    valid: validRows.length,
    invalid: rows.filter((r) => r.errors.length > 0).length,
    warnings: rows.filter((r) => r.warnings.length > 0 || r.normalizationWarnings.length > 0).length,
    duplicatesInFile: rows.filter((r) => r.fileDuplicate).length,
    newRecords: validRows.filter((r) => r.isNew).length,
    updateRecords: validRows.filter((r) => !r.isNew).length,
    unknownEmployees: rows.filter((r) => r.errors.some((e) => e.includes("not found"))).length,
    missingPunchWarnings: rows.filter((r) =>
      r.normalizationWarnings.some((w) => w.includes("without")),
    ).length,
  };
}

export async function rowExistsInAttendance(
  workspaceId: number,
  employeeId: number,
  date: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: hrAttendanceTable.id })
    .from(hrAttendanceTable)
    .where(
      and(
        eq(hrAttendanceTable.workspaceId, workspaceId),
        eq(hrAttendanceTable.employeeId, employeeId),
        eq(hrAttendanceTable.date, date),
      ),
    )
    .limit(1);
  return Boolean(row);
}
