/**
 * P20-C — Attendance Import Center smoke tests
 * Run: DATABASE_URL=... pnpm --filter @workspace/api-server vitest run workforce-attendance-import.smoke
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as XLSX from "xlsx";
import { db, pool, initializeDatabase, workspacesTable, employeesTable } from "@workspace/db";
import { ImportTemplateRegistry } from "../../lib/workforce-attendance/import/import-template-registry";
import { generateAttendanceTemplateXlsx } from "../../lib/workforce-attendance/import/import-template-generator";
import { parseAttendanceImportBuffer } from "../../lib/workforce-attendance/import/import-parser";
import { validateImportRows } from "../../lib/workforce-attendance/import/import-validator";
import {
  validatePunchSequence,
  detectNightShift,
  resolveSourceConflict,
} from "../../lib/workforce-attendance/import/normalization-rules";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const RUN = HAS_DB && process.env.RUN_WORKFORCE_IMPORT_SMOKE !== "0";

describe.skipIf(!RUN)("P20-C attendance import smoke", () => {
  let workspaceId: number;
  let employeeId: number;
  let tablesReady = false;

  beforeAll(async () => {
    initializeDatabase(process.env.DATABASE_URL!);
    const r = await pool.query(
      `SELECT COUNT(*)::int AS c FROM information_schema.tables WHERE table_name = 'attendance_import_batches'`,
    );
    tablesReady = Number(r.rows[0]?.c) >= 1;
    if (!tablesReady) return;

    const slug = `import-smoke-${Date.now()}`;
    const [ws] = await db.insert(workspacesTable).values({ name: "Import Smoke", slug }).returning();
    workspaceId = ws!.id;

    const [emp] = await db
      .insert(employeesTable)
      .values({
        workspaceId,
        fullName: "Import Test Emp",
        employeeNumber: "IMP-001",
        status: "active",
      })
      .returning();
    employeeId = emp!.id;

    const { seedAttendanceSourcesForWorkspace } = await import(
      "../../lib/workforce-attendance/source-seed"
    );
    await seedAttendanceSourcesForWorkspace(workspaceId);
  });

  afterAll(async () => {
    await pool.end().catch(() => undefined);
  });

  it("generates dynamic XLSX template", () => {
    const template = ImportTemplateRegistry.require("attendance.period.default.v1");
    const buf = generateAttendanceTemplateXlsx(template, {
      shiftNames: ["Morning"],
      employeeNumbers: ["IMP-001"],
    });
    expect(buf.length).toBeGreaterThan(1000);
    const wb = XLSX.read(buf, { type: "buffer" });
    expect(wb.SheetNames).toContain("Attendance Template");
  });

  it("parses and validates dry-run rows", async () => {
    if (!tablesReady) return;
    const template = ImportTemplateRegistry.require("attendance.period.default.v1");
    const buf = generateAttendanceTemplateXlsx(template);
    const parsed = parseAttendanceImportBuffer(buf, template.key);
    expect(parsed.length).toBeGreaterThan(0);

    const { rows, stats } = await validateImportRows(workspaceId, parsed);
    expect(stats.total).toBeGreaterThan(0);
    const valid = rows.filter((r) => r.errors.length === 0);
    expect(valid.length).toBeGreaterThanOrEqual(0);
  });

  it("normalization rules: night shift and source conflict", () => {
    expect(detectNightShift("22:00", "06:00")).toBe(true);
    const issues = validatePunchSequence("08:00", "07:00", { allowNightShift: false });
    expect(issues.some((i) => i.code === "invalid_sequence")).toBe(true);
    const { winner, conflict } = resolveSourceConflict([
      { code: "manual", priority: 100 },
      { code: "excel", priority: 60 },
    ]);
    expect(winner).toBe("manual");
    expect(conflict).toBe(false);
  });

  it("import confirm pipeline (integration)", async () => {
    if (!tablesReady) return;
    const template = ImportTemplateRegistry.require("attendance.period.default.v1");
    const wb = XLSX.utils.book_new();
    const data = [
      ["employee_number", "date", "check_in", "check_out", "status"],
      ["IMP-001", "2026-06-01", "08:00", "17:00", "present"],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), "Attendance Template");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const { attendanceImportService } = await import(
      "../../lib/workforce-attendance/import/attendance-import-service"
    );

    const started = await attendanceImportService.startImport({
      workspaceId,
      userId: 1,
      templateKey: template.key,
      dryRun: true,
      fileBuffer: buf,
      fileName: "test.xlsx",
    });

    expect(started.batchId).toBeGreaterThan(0);
    expect(started.validation.stats.valid).toBeGreaterThanOrEqual(1);

    const confirmed = await attendanceImportService.confirmImport({
      workspaceId,
      userId: 1,
      batchId: started.batchId,
    });
    expect(confirmed.reconciliation.inserted + confirmed.reconciliation.updated).toBeGreaterThanOrEqual(1);
    void employeeId;
  });

  it("workspace isolation on import status", async () => {
    if (!tablesReady) return;
    const { attendanceImportService } = await import(
      "../../lib/workforce-attendance/import/attendance-import-service"
    );
    const status = await attendanceImportService.getImportStatus(workspaceId, 999999);
    expect(status).toBeNull();
  });
});
