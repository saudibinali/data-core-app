import * as XLSX from "xlsx";

export type ReportArtifact = {
  buffer: Buffer;
  contentType: string;
  fileName: string;
  rowCount: number;
};

export function buildSpreadsheetArtifact(
  rows: Record<string, unknown>[],
  format: "xlsx" | "csv",
  baseName: string,
  sheetName = "Report",
): ReportArtifact {
  const ws = XLSX.utils.json_to_sheet(rows);
  const rowCount = rows.length;

  if (format === "csv") {
    let csv = XLSX.utils.sheet_to_csv(ws);
    if (baseName.includes("attendance")) {
      csv = "\uFEFF" + csv;
    }
    return {
      buffer: Buffer.from(csv, "utf8"),
      contentType: "text/csv; charset=utf-8",
      fileName: `${baseName}.csv`,
      rowCount,
    };
  }

  const wb = XLSX.utils.book_new();
  ws["!cols"] = Object.keys(rows[0] ?? {}).map(() => ({ wch: 22 }));
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return {
    buffer,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    fileName: `${baseName}.xlsx`,
    rowCount,
  };
}
