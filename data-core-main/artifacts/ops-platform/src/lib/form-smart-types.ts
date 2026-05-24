/** Shared smart-form types (mirrors api-server form-smart-config) */

export type RolePreset = "all" | "member" | "manager_above" | "admin_only";

export interface FormAudienceConfig {
  visibleTo?: RolePreset;
  mode?: "all" | "preset" | "targeted";
  departmentIds?: number[];
  orgUnitIds?: number[];
  positionIds?: number[];
  jobTitleIds?: number[];
  userIds?: number[];
  groupIds?: number[];
}

export type WorkflowApproverType =
  | "manager"
  | "department_head"
  | "role"
  | "specific"
  | "hr_admin";

export interface FormWorkflowStepPlan {
  id: string;
  type: "approval" | "notify";
  approverType?: WorkflowApproverType;
  approverRole?: string;
  approverUserIds?: number[];
  approvalMode?: "single" | "any" | "all";
  title?: string;
  titleAr?: string;
  condition?: { field: string; operator: string; value: string };
}

export interface FormWorkflowPlan {
  enabled: boolean;
  steps: FormWorkflowStepPlan[];
}

export const FORM_CATEGORIES = [
  { value: "leave",       labelEn: "Leave & Time Off",      labelAr: "الإجازات والغياب" },
  { value: "attendance",  labelEn: "Attendance",            labelAr: "الحضور والانصراف" },
  { value: "finance",     labelEn: "Finance & Expenses",    labelAr: "المالية والمصروفات" },
  { value: "hr",          labelEn: "HR Requests",           labelAr: "طلبات الموارد البشرية" },
  { value: "it",          labelEn: "IT & Support",          labelAr: "تقنية المعلومات والدعم" },
  { value: "facilities",  labelEn: "Facilities",            labelAr: "المرافق والخدمات" },
  { value: "travel",      labelEn: "Travel",                labelAr: "السفر والانتداب" },
  { value: "training",    labelEn: "Training & Development", labelAr: "التدريب والتطوير" },
  { value: "general",     labelEn: "General",               labelAr: "عام" },
  { value: "other",       labelEn: "Other",                 labelAr: "أخرى" },
] as const;

export function buildFormWorkflowEventPreview(module: string, formName: string): string {
  const slug = formName
    .toLowerCase()
    .trim()
    .replace(/[\u0600-\u06FF]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .substring(0, 60) || "form";
  return `${module}.${slug}.submitted`;
}

export const DEFAULT_WORKFLOW_PLAN: FormWorkflowPlan = {
  enabled: true,
  steps: [
    {
      id: "step-1",
      type: "approval",
      approverType: "manager",
      approvalMode: "single",
      title: "Manager Approval",
      titleAr: "موافقة المدير المباشر",
    },
  ],
};

export const DEFAULT_AUDIENCE: FormAudienceConfig = {
  mode: "all",
  visibleTo: "all",
};
