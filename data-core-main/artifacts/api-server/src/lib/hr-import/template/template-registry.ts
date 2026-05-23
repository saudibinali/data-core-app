/**
 * Universal import template registry foundation (Phase 1).
 * Does NOT replace legacy employee template — parallel registry only.
 */

export type HrImportColumnDef = {
  key: string;
  labelEn: string;
  labelAr: string;
  required: boolean;
  format?: string;
  validation?: "date" | "email" | "enum" | "lookup" | "text";
  enumRef?: string;
  lookupEntity?: string;
};

export type HrImportTemplateDef = {
  key: string;
  version: string;
  entityType: string;
  titleEn: string;
  titleAr: string;
  supportedFormats: ("xlsx" | "csv" | "json")[];
  sheetName: string;
  columns: HrImportColumnDef[];
  status: "foundation" | "active" | "deprecated";
  minApiVersion: string;
};

const EMPLOYEE_ENTERPRISE_V2_FOUNDATION: HrImportTemplateDef = {
  key: "hr.employee.enterprise.v2.foundation",
  version: "2.0.0-foundation",
  entityType: "employee",
  titleEn: "Employee Import (Enterprise Foundation)",
  titleAr: "استيراد الموظفين (أساس المؤسسة)",
  supportedFormats: ["xlsx", "json"],
  sheetName: "Employee Template",
  status: "foundation",
  minApiVersion: "1.29.0",
  columns: [],
};

const MASTER_DATA_EXPORT_V1: HrImportTemplateDef = {
  key: "hr.master_data.export.v1",
  version: "1.0.0",
  entityType: "master_data_bundle",
  titleEn: "Master Data Export Bundle",
  titleAr: "حزمة تصدير البيانات الرئيسية",
  supportedFormats: ["xlsx", "json"],
  sheetName: "Master Data",
  status: "foundation",
  minApiVersion: "1.29.0",
  columns: [],
};

const REGISTRY: Record<string, HrImportTemplateDef> = {
  [EMPLOYEE_ENTERPRISE_V2_FOUNDATION.key]: EMPLOYEE_ENTERPRISE_V2_FOUNDATION,
  [MASTER_DATA_EXPORT_V1.key]: MASTER_DATA_EXPORT_V1,
};

export class HrImportTemplateRegistry {
  static list(): HrImportTemplateDef[] {
    return Object.values(REGISTRY);
  }

  static get(key: string): HrImportTemplateDef | undefined {
    return REGISTRY[key];
  }

  static require(key: string): HrImportTemplateDef {
    const def = REGISTRY[key];
    if (!def) throw new Error(`Unknown HR import template: ${key}`);
    return def;
  }
}

export { EMPLOYEE_ENTERPRISE_V2_FOUNDATION, MASTER_DATA_EXPORT_V1 };
