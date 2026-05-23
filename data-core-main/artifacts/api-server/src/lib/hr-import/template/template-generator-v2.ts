/**
 * Phase 2 — Runtime XLSX template generator with catalog-driven dropdowns.
 */

import * as XLSX from "xlsx";
import type { HrImportTemplateV2Def } from "./template-registry-v2";
import type { HrImportColumnDef } from "./template-registry";
import type { MasterDataCatalogSnapshot, CustomFieldDropdownCatalog } from "../catalog/master-data-catalog";
import { buildValidationSchema, validationSchemaToSheetRows } from "./validation-schema";
import { CURRENT_API_VERSION } from "./template-registry-v2";

export type TemplateGenerateContext = {
  workspaceId: number;
  catalog: MasterDataCatalogSnapshot;
  customFieldColumns?: HrImportColumnDef[];
  customFieldDropdowns?: CustomFieldDropdownCatalog[];
  numberingMode?: string;
};

type RefSheet = { sheetName: string; values: string[]; valueCol: "A" | "B" };

function colLetter(index: number): string {
  let n = index;
  let s = "";
  while (n >= 0) {
    s = String.fromCharCode((n % 26) + 65) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function addListValidation(
  ws: XLSX.WorkSheet,
  colIndex: number,
  startRow: number,
  endRow: number,
  refSheet: string,
  refCol: string,
  refLen: number,
): void {
  if (refLen < 1) return;
  const col = colLetter(colIndex);
  const sqref = `${col}${startRow}:${col}${endRow}`;
  const formula = `'${refSheet}'!$${refCol}$2:$${refCol}$${refLen + 1}`;
  const dv = {
    type: "list" as const,
    allowBlank: true,
    showInputMessage: true,
    showErrorMessage: true,
    sqref,
    formulas: [formula],
  };
  const existing = (ws as XLSX.WorkSheet & { "!dataValidation"?: unknown[] })["!dataValidation"] ?? [];
  (ws as XLSX.WorkSheet & { "!dataValidation"?: unknown[] })["!dataValidation"] = [...existing, dv];
}

function appendRefSheet(wb: XLSX.WorkBook, name: string, header: string, rows: Array<{ code?: string | null; name: string }>): RefSheet | null {
  if (!rows.length) return null;
  const safeName = name.slice(0, 31);
  const aoa = [[header, "Display Name"], ...rows.map((r) => [r.code ?? r.name, r.name])];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 18 }, { wch: 36 }];
  XLSX.utils.book_append_sheet(wb, ws, safeName);
  return { sheetName: safeName, values: rows.map((r) => r.name), valueCol: "B" };
}

export function generateEmployeeTemplateV2Xlsx(
  template: HrImportTemplateV2Def,
  ctx: TemplateGenerateContext,
): Buffer {
  const wb = XLSX.utils.book_new();
  const columns = [...template.columns, ...(ctx.customFieldColumns ?? [])];
  const { catalog } = ctx;

  const headerAr = columns.map((c) => c.labelAr);
  const headerEn = columns.map((c) => c.labelEn);
  const headerKey = columns.map((c) => c.key);
  const wsData = XLSX.utils.aoa_to_sheet([headerAr, headerEn, headerKey]);
  wsData["!cols"] = columns.map(() => ({ wch: 22 }));

  const refSheets: Array<{ colKey: string; ref: RefSheet }> = [];
  const pushRef = (colKey: string, sheetLabel: string, entries: Array<{ code?: string | null; name: string }> | undefined) => {
    if (!entries?.length) return;
    const ref = appendRefSheet(wb, sheetLabel, "code", entries);
    if (ref) refSheets.push({ colKey, ref });
  };

  pushRef("employment_type", "Ref_EmploymentTypes", catalog.entities.employment_type?.map((e) => ({ code: e.code, name: e.name })));
  pushRef("status", "Ref_Statuses", catalog.entities.employee_status?.map((e) => ({ code: e.code, name: e.name })));
  pushRef("org_unit_name", "Ref_OrgUnits", catalog.entities.org_unit?.map((e) => ({ code: e.code, name: e.name })));
  pushRef("job_title_name", "Ref_JobTitles", catalog.entities.job_title?.map((e) => ({ code: e.code, name: e.name })));
  pushRef("job_grade_name", "Ref_JobGrades", catalog.entities.job_grade?.map((e) => ({ code: e.code, name: e.name })));
  pushRef("position_title", "Ref_Positions", catalog.entities.position?.map((e) => ({ code: e.code, name: e.name })));
  pushRef("work_location", "Ref_WorkLocations", catalog.entities.work_location?.map((e) => ({ code: e.code, name: e.name })));

  for (const cf of ctx.customFieldDropdowns ?? []) {
    pushRef(
      `cf_${cf.fieldName}`,
      `Ref_CF_${cf.fieldName}`.slice(0, 31),
      cf.options.map((o) => ({ code: o.value, name: o.label })),
    );
  }

  const dataStart = template.dataStartRow;
  const dataEnd = 1000;
  for (const { colKey, ref } of refSheets) {
    const colIndex = columns.findIndex((c) => c.key === colKey);
    if (colIndex < 0) continue;
    addListValidation(wsData, colIndex, dataStart, dataEnd, ref.sheetName, ref.valueCol, ref.values.length);
  }

  XLSX.utils.book_append_sheet(wb, wsData, template.sheetName);

  const schema = buildValidationSchema(template, {
    employmentTypeCodes: catalog.entities.employment_type?.map((e) => e.code ?? e.name) ?? [],
    statusCodes: catalog.entities.employee_status?.map((e) => e.code ?? e.name) ?? [],
    customFieldDropdowns: ctx.customFieldDropdowns,
    extraColumns: ctx.customFieldColumns,
  });

  const metaRows = [
    ["template_key", template.key],
    ["template_version", template.version],
    ["workspace_id", String(ctx.workspaceId)],
    ["generated_at", new Date().toISOString()],
    ["api_version", CURRENT_API_VERSION],
    ["numbering_mode", ctx.numberingMode ?? "auto"],
    ["catalog_generated_at", catalog.generatedAt],
    ["data_start_row", String(template.dataStartRow)],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(metaRows), "_metadata");

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(validationSchemaToSheetRows(schema)), "_validation");

  const instr = [
    ["Field", "EN", "AR", "Required", "Format"],
    ...columns.map((c) => [c.key, c.labelEn, c.labelAr, c.required ? "YES" : "no", c.format ?? c.validation ?? "text"]),
    [],
    ["NOTE", "Row 1=AR, Row 2=EN, Row 3=keys, data from row 4", "", "", ""],
    ["NOTE", "Dropdown columns use catalog values from reference sheets", "", "", ""],
    ["NOTE", `Template ${template.key} v${template.version}`, "", "", ""],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(instr), "Instructions");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function parseTemplateMetadataFromUpload(wb: XLSX.WorkBook): {
  templateKey?: string;
  templateVersion?: string;
  generatedAt?: string;
} {
  const sheet = wb.Sheets["_metadata"];
  if (!sheet) return {};
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { header: ["k", "v"], range: 0 });
  const map = Object.fromEntries(rows.filter((r) => r.k && r.v).map((r) => [r.k, r.v]));
  return {
    templateKey: map.template_key,
    templateVersion: map.template_version,
    generatedAt: map.generated_at,
  };
}
