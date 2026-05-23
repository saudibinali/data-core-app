import type { ProcessTemplate } from "./types";

/** Business-readable process templates (no trigger_event / JSON conditions). */
export const BUSINESS_PROCESS_TEMPLATES: ProcessTemplate[] = [
  {
    code: "leave.standard",
    name: "Leave — Direct Manager",
    nameAr: "إجازة — المدير المباشر",
    routingType: "direct_manager",
    chainDepth: 1,
    timeoutHours: 48,
    description: "When an employee submits leave, their direct manager approves.",
    descriptionAr: "عند تقديم طلب إجازة، يوافق المدير المباشر.",
  },
  {
    code: "leave.manager_chain",
    name: "Leave — Manager Chain",
    nameAr: "إجازة — سلسلة المدراء",
    routingType: "manager_chain",
    chainDepth: 2,
    timeoutHours: 48,
    description: "Sequential approval by direct manager then next level.",
    descriptionAr: "موافقة متسلسلة من المدير المباشر ثم المستوى التالي.",
  },
  {
    code: "hr.transfer",
    name: "Internal Transfer",
    nameAr: "نقل داخلي",
    routingType: "org_unit_head",
    chainDepth: 1,
    timeoutHours: 72,
    description: "Department head approves internal employee transfer.",
    descriptionAr: "رئيس القسم يوافق على النقل الداخلي.",
  },
  {
    code: "hr.onboarding",
    name: "Onboarding Checklist",
    nameAr: "قائمة الانضمام",
    routingType: "hr_director",
    chainDepth: 1,
    timeoutHours: 96,
    description: "HR director sign-off for onboarding completion.",
    descriptionAr: "اعتماد مدير الموارد البشرية لإكمال الانضمام.",
  },
];

export function describeRoutingType(routingType: string, isAr = false): string {
  const map: Record<string, { en: string; ar: string }> = {
    direct_manager: { en: "Direct manager", ar: "المدير المباشر" },
    manager_chain: { en: "Manager chain", ar: "سلسلة المدراء" },
    org_unit_head: { en: "Department head", ar: "رئيس القسم" },
    division_head: { en: "Division manager", ar: "مدير الشعبة" },
    hr_director: { en: "HR director", ar: "مدير الموارد البشرية" },
    executive: { en: "Executive", ar: "الإدارة التنفيذية" },
    parallel_all: { en: "All approvers (parallel)", ar: "جميع المعتمدين (متوازي)" },
    parallel_any: { en: "Any approver (parallel)", ar: "أي معتمد (متوازي)" },
  };
  const row = map[routingType] ?? { en: routingType, ar: routingType };
  return isAr ? row.ar : row.en;
}
