import * as XLSX from "xlsx";
import {
  ImportTemplateRegistry,
  type ImportTemplateDef,
} from "./import-template-registry";

export function generateAttendanceTemplateXlsx(
  template: ImportTemplateDef,
  options?: { shiftNames?: string[]; employeeNumbers?: string[] },
): Buffer {
  const wb = XLSX.utils.book_new();
  const headerEn = template.columns.map((c) => c.headers[0]!);
  const headerAr = template.columns.map((c) => c.labelAr);
  const sampleAoA = template.sampleRows.map((row) =>
    template.columns.map((col) => row[col.key] ?? ""),
  );
  const ws1 = XLSX.utils.aoa_to_sheet([headerAr, headerEn, ...sampleAoA]);
  ws1["!cols"] = template.columns.map(() => ({ wch: 20 }));
  XLSX.utils.book_append_sheet(wb, ws1, template.sheetName);

  const instructions = [
    ["Field", "Description EN", "وصف عربي", "Required", "Format / Values"],
    ...template.columns.map((c) => [
      c.headers[0],
      c.labelEn,
      c.labelAr,
      c.required ? "YES" : "NO",
      c.format ?? "",
    ]),
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(instructions);
  ws2["!cols"] = [{ wch: 22 }, { wch: 35 }, { wch: 35 }, { wch: 10 }, { wch: 55 }];
  XLSX.utils.book_append_sheet(wb, ws2, "Instructions");

  const statusVals = [
    ["Status Code", "English Label", "Arabic Label"],
    ...template.statusValues.map((s) => [s.code, s.labelEn, s.labelAr]),
  ];
  const ws3 = XLSX.utils.aoa_to_sheet(statusVals);
  XLSX.utils.book_append_sheet(wb, ws3, "Status Values");

  if (options?.shiftNames?.length) {
    const shifts = [["shift_name"], ...options.shiftNames.map((n) => [n])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(shifts), "Shifts");
  }
  if (options?.employeeNumbers?.length) {
    const emps = [["employee_number"], ...options.employeeNumbers.slice(0, 500).map((n) => [n])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(emps), "Employees");
  }

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function getTemplateMetadata(templateKey: string) {
  const template = ImportTemplateRegistry.require(templateKey);
  return {
    key: template.key,
    version: template.version,
    titleEn: template.titleEn,
    titleAr: template.titleAr,
    supportedFormats: template.supportedFormats,
    columns: template.columns.map((c) => ({
      key: c.key,
      labelEn: c.labelEn,
      labelAr: c.labelAr,
      required: c.required,
      format: c.format,
      headers: c.headers,
    })),
    sampleRows: template.sampleRows,
    statusValues: template.statusValues,
  };
}
