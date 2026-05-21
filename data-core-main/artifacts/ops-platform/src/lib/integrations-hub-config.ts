/**
 * Integration hub catalog — product surface for tenant admins.
 * Runtime wiring may be partial; status reflects current codebase capability.
 */

export type IntegrationRuntimeStatus =
  | "active"
  | "partial"
  | "planned"
  | "platform_only";

export type IntegrationCategoryId =
  | "attendance_devices"
  | "email_smtp"
  | "payroll_export"
  | "erp_finance"
  | "hris"
  | "webhooks_outbound"
  | "api_keys"
  | "oauth_sso"
  | "ai_automation"
  | "storage_files";

export interface IntegrationCatalogEntry {
  id: IntegrationCategoryId;
  labelEn: string;
  labelAr: string;
  status: IntegrationRuntimeStatus;
  requiredModule?: string;
  requiredPermission?: string;
  planNoteEn: string;
  planNoteAr: string;
  configurePath?: string;
}

export const INTEGRATION_CATALOG: IntegrationCatalogEntry[] = [
  {
    id: "attendance_devices",
    labelEn: "Attendance & time clocks",
    labelAr: "الحضور وأجهزة البصمة",
    status: "active",
    requiredPermission: "hr.manage",
    planNoteEn: "Available on HR plans. Connect via webhook or REST poll.",
    planNoteAr: "متاح مع وحدة الموارد البشرية.\nالربط عبر Webhook أو سحب REST.",
    configurePath: "/admin/integrations?tab=attendance",
  },
  {
    id: "email_smtp",
    labelEn: "Email (SMTP)",
    labelAr: "البريد الإلكتروني (SMTP)",
    status: "active",
    requiredPermission: "admin",
    planNoteEn: "Workspace admin configures outbound mail for notifications.",
    planNoteAr: "مدير مساحة العمل يضبط البريد الصادر للإشعارات والدعوات.",
    configurePath: "/admin/integrations?tab=email",
  },
  {
    id: "payroll_export",
    labelEn: "Payroll / GL export",
    labelAr: "تصدير الرواتب / دفتر الأستاذ",
    status: "partial",
    requiredPermission: "hr.payroll.export",
    planNoteEn: "Export files for external accounting (Oracle, SAP, etc.) — not live bidirectional API.",
    planNoteAr: "تصدير ملفات للمحاسبة الخارجية (Oracle، SAP).\nليس API ثنائي الاتجاه مباشراً.",
    configurePath: "/admin/hr/payroll-ops",
  },
  {
    id: "erp_finance",
    labelEn: "ERP / finance systems",
    labelAr: "أنظمة ERP والمالية",
    status: "planned",
    requiredModule: "integrations",
    planNoteEn: "Business plan+ and integrations module. Generic connectors planned.",
    planNoteAr: "يتطلب خطة Business أو أعلى، ووحدة التكاملات.\nالموصلات العامة قيد التطوير.",
  },
  {
    id: "hris",
    labelEn: "HRIS / core HR sync",
    labelAr: "مزامنة HRIS",
    status: "planned",
    requiredModule: "integrations",
    planNoteEn: "Employee/org sync via API — not yet in tenant UI.",
    planNoteAr: "مزامنة الموظفين والهيكل التنظيمي عبر API.\nواجهة العميل قيد الإعداد.",
  },
  {
    id: "webhooks_outbound",
    labelEn: "Outbound webhooks",
    labelAr: "Webhooks صادرة",
    status: "planned",
    requiredModule: "integrations",
    planNoteEn: "Notify external systems on platform events.",
    planNoteAr: "إرسال إشعارات للأنظمة الخارجية عند أحداث المنصة.",
  },
  {
    id: "api_keys",
    labelEn: "API keys (machine access)",
    labelAr: "مفاتيح API",
    status: "planned",
    requiredModule: "integrations",
    planNoteEn: "Scoped keys for partners — platform settings shows coming soon.",
    planNoteAr: "مفاتيح API بنطاق محدد للشركاء.\nقيد التفعيل في إعدادات المنصة.",
  },
  {
    id: "oauth_sso",
    labelEn: "OAuth / SSO",
    labelAr: "OAuth / تسجيل موحد",
    status: "planned",
    planNoteEn: "Enterprise identity federation — not enabled for tenants yet.",
    planNoteAr: "ربط هوية المؤسسة — غير مفعّل للعملاء بعد.",
  },
  {
    id: "ai_automation",
    labelEn: "AI & automation",
    labelAr: "الذكاء الاصطناعي والأتمتة",
    status: "partial",
    requiredModule: "ai_automation",
    planNoteEn: "Enterprise plan module; usage counters not measured yet.",
    planNoteAr: "يتطلب وحدة Enterprise.\nعداد الاستخدام غير مفعّل بعد.",
  },
  {
    id: "storage_files",
    labelEn: "Documents & storage",
    labelAr: "المستندات والتخزين",
    status: "partial",
    planNoteEn: "HR documents in-platform; external DMS connector planned.",
    planNoteAr: "مستندات الموارد البشرية داخل المنصة.\nموصل أنظمة أرشفة خارجية (DMS) مخطط.",
  },
];

export const ATTENDANCE_CONNECTOR_LABELS: Record<
  string,
  { en: string; ar: string; modes: string }
> = {
  generic_webhook: {
    en: "Generic webhook",
    ar: "Webhook عام",
    modes: "Push (real-time punches)",
  },
  generic_rest_poll: {
    en: "Generic REST poll",
    ar: "سحب REST عام",
    modes: "Pull from vendor API",
  },
  direct_api: {
    en: "Direct API bridge",
    ar: "جسر API مباشر",
    modes: "Webhook + optional poll",
  },
  excel_import: {
    en: "Excel / file import",
    ar: "استيراد Excel",
    modes: "Batch file via import center",
  },
};

/** Renders catalog notes with intentional line breaks (Arabic/English typography). */
export function formatIntegrationPlanNote(text: string): string[] {
  return text.split("\n").map((line) => line.trim()).filter(Boolean);
}

export function integrationStatusLabel(
  status: IntegrationRuntimeStatus,
  isAr: boolean,
): string {
  const map: Record<IntegrationRuntimeStatus, { en: string; ar: string }> = {
    active: { en: "Active", ar: "مفعّل" },
    partial: { en: "Partial", ar: "جزئي" },
    planned: { en: "Not enabled", ar: "غير مفعّل" },
    platform_only: { en: "Platform only", ar: "منصة فقط" },
  };
  return isAr ? map[status].ar : map[status].en;
}
