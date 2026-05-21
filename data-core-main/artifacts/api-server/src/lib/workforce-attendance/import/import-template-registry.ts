/** P20-C — Canonical attendance import template definitions */

export type ImportColumnDef = {
  key: string;
  headers: string[];
  labelEn: string;
  labelAr: string;
  required: boolean;
  format?: string;
  validation?: "date" | "time" | "integer" | "status" | "source_type";
};

export type ImportTemplateDef = {
  key: string;
  version: string;
  titleEn: string;
  titleAr: string;
  supportedFormats: ("xlsx" | "csv")[];
  sheetName: string;
  columns: ImportColumnDef[];
  sampleRows: Record<string, string>[];
  statusValues: Array<{ code: string; labelEn: string; labelAr: string }>;
};

const STATUS_VALUES = [
  { code: "present", labelEn: "Present", labelAr: "حاضر" },
  { code: "absent", labelEn: "Absent", labelAr: "غائب" },
  { code: "late", labelEn: "Late", labelAr: "متأخر" },
  { code: "half_day", labelEn: "Half Day", labelAr: "نصف يوم" },
  { code: "on_leave", labelEn: "On Leave", labelAr: "إجازة" },
  { code: "holiday", labelEn: "Holiday", labelAr: "عطلة" },
  { code: "remote", labelEn: "Remote", labelAr: "عن بُعد" },
];

export const ATTENDANCE_PERIOD_DEFAULT_V1: ImportTemplateDef = {
  key: "attendance.period.default.v1",
  version: "1.0.0",
  titleEn: "Attendance Period Import",
  titleAr: "استيراد الحضور للفترة",
  supportedFormats: ["xlsx", "csv"],
  sheetName: "Attendance Template",
  columns: [
    {
      key: "employeeNumber",
      headers: ["employee_number", "رقم الموظف", "Employee Number"],
      labelEn: "Employee Number",
      labelAr: "رقم الموظف",
      required: true,
    },
    {
      key: "date",
      headers: ["date", "التاريخ", "Date"],
      labelEn: "Date",
      labelAr: "التاريخ",
      required: true,
      format: "YYYY-MM-DD",
      validation: "date",
    },
    {
      key: "checkIn",
      headers: ["check_in", "وقت الدخول", "Check In"],
      labelEn: "Check In",
      labelAr: "وقت الدخول",
      required: false,
      format: "HH:MM",
      validation: "time",
    },
    {
      key: "checkOut",
      headers: ["check_out", "وقت الخروج", "Check Out"],
      labelEn: "Check Out",
      labelAr: "وقت الخروج",
      required: false,
      format: "HH:MM",
      validation: "time",
    },
    {
      key: "status",
      headers: ["status", "الحالة", "Status"],
      labelEn: "Status",
      labelAr: "الحالة",
      required: true,
      validation: "status",
    },
    {
      key: "shiftName",
      headers: ["shift_name", "اسم الشيفت", "Shift Name"],
      labelEn: "Shift Name",
      labelAr: "اسم الشيفت",
      required: false,
    },
    {
      key: "overtimeMinutes",
      headers: ["overtime_minutes", "دقائق الأوفرتايم", "Overtime Minutes"],
      labelEn: "Overtime Minutes",
      labelAr: "دقائق الأوفرتايم",
      required: false,
      validation: "integer",
    },
    {
      key: "lateMinutes",
      headers: ["late_minutes", "دقائق التأخير", "Late Minutes"],
      labelEn: "Late Minutes",
      labelAr: "دقائق التأخير",
      required: false,
      validation: "integer",
    },
    {
      key: "earlyLeaveMinutes",
      headers: ["early_leave_minutes", "دقائق المغادرة المبكرة", "Early Leave Minutes"],
      labelEn: "Early Leave Minutes",
      labelAr: "دقائق المغادرة المبكرة",
      required: false,
      validation: "integer",
    },
    {
      key: "sourceType",
      headers: ["source_type", "مصدر التسجيل", "Source Type"],
      labelEn: "Source Type",
      labelAr: "مصدر التسجيل",
      required: false,
      validation: "source_type",
    },
    {
      key: "notes",
      headers: ["notes", "ملاحظات", "Notes"],
      labelEn: "Notes",
      labelAr: "ملاحظات",
      required: false,
    },
  ],
  sampleRows: [
    {
      employeeNumber: "EMP-001",
      date: "2026-05-01",
      checkIn: "08:05",
      checkOut: "17:10",
      status: "present",
      shiftName: "Morning Shift",
      overtimeMinutes: "30",
      lateMinutes: "5",
      earlyLeaveMinutes: "0",
      sourceType: "manual",
      notes: "Normal day",
    },
    {
      employeeNumber: "EMP-002",
      date: "2026-05-01",
      checkIn: "",
      checkOut: "",
      status: "absent",
      shiftName: "",
      overtimeMinutes: "0",
      lateMinutes: "0",
      earlyLeaveMinutes: "0",
      sourceType: "system",
      notes: "Sick leave",
    },
  ],
  statusValues: STATUS_VALUES,
};

const REGISTRY: Record<string, ImportTemplateDef> = {
  [ATTENDANCE_PERIOD_DEFAULT_V1.key]: ATTENDANCE_PERIOD_DEFAULT_V1,
};

export class ImportTemplateRegistry {
  static list(): ImportTemplateDef[] {
    return Object.values(REGISTRY);
  }

  static get(key: string): ImportTemplateDef | null {
    return REGISTRY[key] ?? null;
  }

  static require(key: string): ImportTemplateDef {
    const t = REGISTRY[key];
    if (!t) throw new Error(`Unknown import template: ${key}`);
    return t;
  }
}
