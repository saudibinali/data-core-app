import * as XLSX from "xlsx";
import {
  ImportTemplateRegistry,
  type ImportTemplateDef,
  type ImportColumnDef,
} from "./import-template-registry";

export type ParsedImportRow = {
  rowNumber: number;
  raw: Record<string, string>;
  mapped: Record<string, string>;
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, "_");
}

function findHeaderRow(sheet: XLSX.WorkSheet, template: ImportTemplateDef): {
  headerRowIndex: number;
  colIndexByKey: Map<string, number>;
} {
  const ref = sheet["!ref"];
  if (!ref) return { headerRowIndex: -1, colIndexByKey: new Map() };

  const range = XLSX.utils.decode_range(ref);
  const allHeaders = new Set(
    template.columns.flatMap((c) => c.headers.map((h) => normalizeHeader(h))),
  );

  for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 5); r++) {
    const colIndexByKey = new Map<string, number>();
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      const val = cell?.v != null ? String(cell.v).trim() : "";
      if (!val) continue;
      const norm = normalizeHeader(val);
      for (const col of template.columns) {
        if (col.headers.some((h) => normalizeHeader(h) === norm)) {
          colIndexByKey.set(col.key, c);
        }
      }
    }
    if (colIndexByKey.size >= 2) return { headerRowIndex: r, colIndexByKey };
  }
  return { headerRowIndex: -1, colIndexByKey: new Map() };
}

function mapRow(
  sheet: XLSX.WorkSheet,
  rowIndex: number,
  colIndexByKey: Map<string, number>,
  columns: ImportColumnDef[],
): Record<string, string> {
  const mapped: Record<string, string> = {};
  for (const col of columns) {
    const idx = colIndexByKey.get(col.key);
    if (idx == null) {
      mapped[col.key] = "";
      continue;
    }
    const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: idx })];
    mapped[col.key] = cell?.v != null ? String(cell.v).trim() : "";
  }
  return mapped;
}

export function parseAttendanceImportBuffer(
  buffer: Buffer,
  templateKey: string,
  mimeType?: string,
): ParsedImportRow[] {
  const template = ImportTemplateRegistry.require(templateKey);
  const isCsv =
    mimeType?.includes("csv") ||
    buffer.slice(0, 200).toString("utf8").includes(",") && !buffer[0]?.toString().includes("PK");

  const wb = isCsv
    ? XLSX.read(buffer.toString("utf8"), { type: "string" })
    : XLSX.read(buffer, { type: "buffer" });

  const sheetName =
    wb.SheetNames.find((n) => n === template.sheetName) ?? wb.SheetNames[0];
  if (!sheetName) return [];

  const sheet = wb.Sheets[sheetName]!;
  const { headerRowIndex, colIndexByKey } = findHeaderRow(sheet, template);
  if (headerRowIndex < 0) return [];

  const ref = sheet["!ref"];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const rows: ParsedImportRow[] = [];

  for (let r = headerRowIndex + 1; r <= range.e.r; r++) {
    const mapped = mapRow(sheet, r, colIndexByKey, template.columns);
    const hasData = Object.values(mapped).some((v) => v !== "");
    if (!hasData) continue;
    const raw: Record<string, string> = {};
    for (const col of template.columns) {
      raw[col.headers[0]!] = mapped[col.key] ?? "";
    }
    rows.push({ rowNumber: r - headerRowIndex, raw, mapped });
  }
  return rows;
}

export function parseAttendanceImportCsvText(text: string, templateKey: string): ParsedImportRow[] {
  return parseAttendanceImportBuffer(Buffer.from(text, "utf8"), templateKey, "text/csv");
}
