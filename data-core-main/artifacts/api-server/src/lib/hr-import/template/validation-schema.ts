/**
 * Phase 2 — Validation metadata for _validation sheet + API schema export.
 */

import type { HrImportColumnDef } from "./template-registry";
import type { HrImportTemplateV2Def } from "./template-registry-v2";
import type { CustomFieldDropdownCatalog } from "../catalog/master-data-catalog";

export type ValidationFieldMeta = {
  key: string;
  labelEn: string;
  labelAr: string;
  required: boolean;
  type: string;
  pattern?: string;
  enumRef?: string;
  fkEntity?: string;
  runtimeHint?: string;
};

export type ValidationSchemaExport = {
  templateKey: string;
  templateVersion: string;
  generatedAt: string;
  fields: ValidationFieldMeta[];
  enumRefs: Record<string, string[]>;
  strictModeEnabled: false;
};

const DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";
const EMAIL_PATTERN = "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$";

const GENDER_VALUES = ["male", "female", "other", "prefer_not_to_say"];
const MARITAL_VALUES = ["single", "married", "divorced", "widowed"];

function colType(col: HrImportColumnDef): string {
  if (col.validation === "date") return "date";
  if (col.validation === "email") return "email";
  if (col.validation === "enum") return "enum";
  if (col.validation === "lookup") return "fk";
  return "text";
}

export function buildValidationSchema(
  template: HrImportTemplateV2Def,
  options: {
    employmentTypeCodes?: string[];
    statusCodes?: string[];
    customFieldDropdowns?: CustomFieldDropdownCatalog[];
    extraColumns?: HrImportColumnDef[];
  } = {},
): ValidationSchemaExport {
  const columns = [...template.columns, ...(options.extraColumns ?? [])];
  const enumRefs: Record<string, string[]> = {};

  if (options.employmentTypeCodes?.length) enumRefs.employment_type = options.employmentTypeCodes;
  if (options.statusCodes?.length) enumRefs.employee_status = options.statusCodes;
  enumRefs.gender_static = GENDER_VALUES;

  for (const cf of options.customFieldDropdowns ?? []) {
    enumRefs[`custom_field.${cf.fieldName}`] = cf.options.map((o) => o.value);
  }

  const fields: ValidationFieldMeta[] = columns.map((col) => {
    const type = colType(col);
    const meta: ValidationFieldMeta = {
      key: col.key,
      labelEn: col.labelEn,
      labelAr: col.labelAr,
      required: col.required,
      type,
      enumRef: col.enumRef,
      fkEntity: col.lookupEntity,
    };
    if (type === "date") meta.pattern = DATE_PATTERN;
    if (type === "email") meta.pattern = EMAIL_PATTERN;
    if (col.key === "marital_status") {
      meta.type = "enum";
      meta.enumRef = "marital_status_static";
      enumRefs.marital_status_static = MARITAL_VALUES;
    }
    if (col.validation === "lookup") {
      meta.runtimeHint = `Resolve via catalog entity: ${col.lookupEntity}`;
    }
    return meta;
  });

  return {
    templateKey: template.key,
    templateVersion: template.version,
    generatedAt: new Date().toISOString(),
    fields,
    enumRefs,
    strictModeEnabled: false,
  };
}

/** Rows for _validation sheet (machine-readable). */
export function validationSchemaToSheetRows(schema: ValidationSchemaExport): string[][] {
  const header = ["key", "required", "type", "pattern", "enumRef", "fkEntity", "runtimeHint"];
  const rows = schema.fields.map((f) => [
    f.key,
    f.required ? "YES" : "no",
    f.type,
    f.pattern ?? "",
    f.enumRef ?? "",
    f.fkEntity ?? "",
    f.runtimeHint ?? "",
  ]);
  return [header, ...rows, [], ["enumRefs", JSON.stringify(schema.enumRefs)]];
}
