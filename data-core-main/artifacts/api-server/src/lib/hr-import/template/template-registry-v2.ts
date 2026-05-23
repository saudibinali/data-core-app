/**
 * Phase 2 — Template registry v2 with full column defs + versioning metadata.
 */

import type { HrImportColumnDef } from "./template-registry";

export type HrImportTemplateV2Def = {
  key: string;
  version: string;
  entityType: string;
  titleEn: string;
  titleAr: string;
  supportedFormats: ("xlsx" | "json")[];
  sheetName: string;
  dataStartRow: number;
  headerRows: number;
  columns: HrImportColumnDef[];
  status: "foundation" | "active" | "deprecated";
  minApiVersion: string;
  compatibility: {
    legacyTemplateCompatible: boolean;
    staleAfterDays: number;
  };
};

export const CURRENT_API_VERSION = "1.30.0";

const EMPLOYEE_CORE_COLUMNS: HrImportColumnDef[] = [
  { key: "employee_number", labelEn: "Employee Number", labelAr: "رقم الموظف", required: false, format: "Auto or manual per workspace", validation: "text" },
  { key: "full_name", labelEn: "Full Name", labelAr: "الاسم الكامل", required: true, validation: "text" as never },
  { key: "first_name", labelEn: "First Name", labelAr: "الاسم الأول", required: false },
  { key: "last_name", labelEn: "Last Name", labelAr: "اسم العائلة", required: false },
  { key: "email", labelEn: "Email", labelAr: "البريد الإلكتروني", required: false, validation: "email" },
  { key: "phone_number", labelEn: "Phone Number", labelAr: "رقم الهاتف", required: false },
  { key: "employment_type", labelEn: "Employment Type", labelAr: "نوع التوظيف", required: false, validation: "enum", enumRef: "employment_type", lookupEntity: "employment_type" },
  { key: "status", labelEn: "Status", labelAr: "الحالة", required: false, validation: "enum", enumRef: "employee_status", lookupEntity: "employee_status" },
  { key: "hire_date", labelEn: "Hire Date", labelAr: "تاريخ التوظيف", required: false, format: "YYYY-MM-DD", validation: "date" },
  { key: "end_date", labelEn: "End Date", labelAr: "تاريخ انتهاء العقد", required: false, format: "YYYY-MM-DD", validation: "date" },
  { key: "probation_end_date", labelEn: "Probation End Date", labelAr: "نهاية فترة الاختبار", required: false, format: "YYYY-MM-DD", validation: "date" },
  { key: "org_unit_name", labelEn: "Org Unit / Department", labelAr: "الوحدة التنظيمية", required: false, validation: "lookup", lookupEntity: "org_unit" },
  { key: "job_title_name", labelEn: "Job Title", labelAr: "المسمى الوظيفي", required: false, validation: "lookup", lookupEntity: "job_title" },
  { key: "job_grade_name", labelEn: "Job Grade", labelAr: "الدرجة الوظيفية", required: false, validation: "lookup", lookupEntity: "job_grade" },
  { key: "position_title", labelEn: "Position", labelAr: "المنصب", required: false, validation: "lookup", lookupEntity: "position" },
  { key: "direct_manager_num", labelEn: "Manager Employee #", labelAr: "رقم المدير المباشر", required: false },
  { key: "work_location", labelEn: "Work Location", labelAr: "موقع العمل", required: false, validation: "lookup", lookupEntity: "work_location" },
  { key: "nationality", labelEn: "Nationality", labelAr: "الجنسية", required: false },
  { key: "gender", labelEn: "Gender", labelAr: "الجنس", required: false, validation: "enum", enumRef: "gender_static" },
  { key: "date_of_birth", labelEn: "Date of Birth", labelAr: "تاريخ الميلاد", required: false, format: "YYYY-MM-DD", validation: "date" },
  { key: "marital_status", labelEn: "Marital Status", labelAr: "الحالة الاجتماعية", required: false },
  { key: "national_id", labelEn: "National ID", labelAr: "رقم الهوية", required: false },
  { key: "passport_number", labelEn: "Passport Number", labelAr: "رقم الجواز", required: false },
  { key: "address", labelEn: "Address", labelAr: "العنوان", required: false },
  { key: "company", labelEn: "Company", labelAr: "الشركة", required: false },
  { key: "branch", labelEn: "Branch", labelAr: "الفرع", required: false },
  { key: "notes", labelEn: "Notes", labelAr: "ملاحظات", required: false },
  { key: "emergency_name", labelEn: "Emergency Contact Name", labelAr: "اسم جهة الطوارئ", required: false },
  { key: "emergency_phone", labelEn: "Emergency Contact Phone", labelAr: "هاتف جهة الطوارئ", required: false },
  { key: "emergency_relation", labelEn: "Emergency Relation", labelAr: "صلة القرابة للطوارئ", required: false },
];

export const HR_EMPLOYEE_V2: HrImportTemplateV2Def = {
  key: "hr.employee.enterprise.v2",
  version: "2.1.0",
  entityType: "employee",
  titleEn: "Employee Import (Enterprise v2)",
  titleAr: "استيراد الموظفين (مؤسسة v2)",
  supportedFormats: ["xlsx", "json"],
  sheetName: "Employee Template",
  dataStartRow: 4,
  headerRows: 3,
  columns: EMPLOYEE_CORE_COLUMNS,
  status: "active",
  minApiVersion: "1.30.0",
  compatibility: { legacyTemplateCompatible: true, staleAfterDays: 30 },
};

export const HR_MASTER_DATA_V2: HrImportTemplateV2Def = {
  key: "hr.master_data.bundle.v2",
  version: "2.1.0",
  entityType: "master_data_bundle",
  titleEn: "HR Master Data Bundle (v2)",
  titleAr: "حزمة بيانات HR الرئيسية (v2)",
  supportedFormats: ["xlsx", "json"],
  sheetName: "Master Data Overview",
  dataStartRow: 2,
  headerRows: 1,
  columns: [
    { key: "entity_type", labelEn: "Entity Type", labelAr: "نوع الكيان", required: true },
    { key: "code", labelEn: "Code", labelAr: "الرمز", required: false },
    { key: "name_en", labelEn: "Name (EN)", labelAr: "الاسم (EN)", required: true },
    { key: "name_ar", labelEn: "Name (AR)", labelAr: "الاسم (AR)", required: false },
  ],
  status: "foundation",
  minApiVersion: "1.30.0",
  compatibility: { legacyTemplateCompatible: false, staleAfterDays: 30 },
};

const REGISTRY_V2: Record<string, HrImportTemplateV2Def> = {
  [HR_EMPLOYEE_V2.key]: HR_EMPLOYEE_V2,
  [HR_MASTER_DATA_V2.key]: HR_MASTER_DATA_V2,
};

export class HrImportTemplateRegistryV2 {
  static list(): HrImportTemplateV2Def[] {
    return Object.values(REGISTRY_V2);
  }

  static get(key: string): HrImportTemplateV2Def | undefined {
    return REGISTRY_V2[key];
  }

  static require(key: string): HrImportTemplateV2Def {
    const def = REGISTRY_V2[key];
    if (!def) throw new Error(`Unknown HR import template v2: ${key}`);
    return def;
  }

  static isStale(templateVersion: string, templateKey: string, generatedAt?: string): boolean {
    const def = REGISTRY_V2[templateKey];
    if (!def || def.version === templateVersion) return false;
    if (!generatedAt) return true;
    const age = Date.now() - new Date(generatedAt).getTime();
    return age > def.compatibility.staleAfterDays * 86_400_000;
  }
}
