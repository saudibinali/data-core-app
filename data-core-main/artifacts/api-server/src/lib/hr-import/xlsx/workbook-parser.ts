/**
 * Phase 3 — Server-side XLSX workbook parsing.
 */

import * as XLSX from "xlsx";
import { HR_EMPLOYEE_V2 } from "../template/template-registry-v2";

export type ParsedWorkbook = {
  workbook: XLSX.WorkBook;
  sheetNames: string[];
};

export type ParsedImportRows = {
  templateKey: string;
  rows: Record<string, string>[];
  keyRowIndex: number;
  dataStartRow: number;
  sheetName: string;
};

export function parseWorkbookBuffer(buffer: Buffer): ParsedWorkbook {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  return { workbook, sheetNames: workbook.SheetNames };
}

export function parseMetadataSheet(workbook: XLSX.WorkBook): Record<string, string> {
  const sheet = workbook.Sheets["_metadata"];
  if (!sheet) return {};
  const aoa = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "" });
  const map: Record<string, string> = {};
  for (const row of aoa) {
    if (row[0] && row[1] != null) map[String(row[0]).trim()] = String(row[1]).trim();
  }
  return map;
}

export function parseEmployeeTemplateRows(
  workbook: XLSX.WorkBook,
  sheetName = "Employee Template",
): ParsedImportRows | null {
  const sheet = workbook.Sheets[sheetName] ?? workbook.Sheets[workbook.SheetNames[0]!];
  if (!sheet) return null;

  const aoa = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "" });
  if (aoa.length < 4) return null;

  const keyRow = aoa[2] as string[];
  const dataStartRow = 4;
  const rows: Record<string, string>[] = [];

  for (let i = 3; i < aoa.length; i++) {
    const cells = aoa[i] as string[];
    if (!cells.some((c) => String(c ?? "").trim())) continue;
    const row: Record<string, string> = {};
    for (let c = 0; c < keyRow.length; c++) {
      const key = String(keyRow[c] ?? "").trim();
      if (!key) continue;
      row[key] = String(cells[c] ?? "").trim();
    }
    if (Object.keys(row).length) rows.push(row);
  }

  return {
    templateKey: HR_EMPLOYEE_V2.key,
    rows,
    keyRowIndex: 3,
    dataStartRow,
    sheetName: sheetName in workbook.Sheets ? sheetName : workbook.SheetNames[0]!,
  };
}

export function parseMasterDataRows(workbook: XLSX.WorkBook): Record<string, string>[] {
  const sheet =
    workbook.Sheets["Master Data"] ??
    workbook.Sheets["Master Data Overview"] ??
    workbook.Sheets[workbook.SheetNames[0]!];
  if (!sheet) return [];
  const json = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "" });
  return json
    .map((r) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(r)) out[k.trim()] = String(v ?? "").trim();
      return out;
    })
    .filter((r) => Object.values(r).some(Boolean));
}
