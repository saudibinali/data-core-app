import { db } from "@workspace/db";
import {
  formDefinitionsTable,
  formFieldsTable,
  workspacesTable,
} from "@workspace/db";
import { eq, count, sql, and } from "drizzle-orm";
import { logger } from "../lib/logger";

interface SeedField {
  name: string;
  label: string;
  labelAr?: string;
  type: string;
  required: boolean;
  placeholder?: string;
  placeholderAr?: string;
  defaultValue?: string;
  options?: { value: string; label: string; labelAr?: string }[];
  validation?: Record<string, unknown>;
  displayOrder: number;
}

interface SeedForm {
  name: string;
  nameAr: string;
  description: string;
  descriptionAr: string;
  module: string;
  category: string;
  status: string;
  workflowEvent: string;
  fields: SeedField[];
}

const SEED_FORMS: SeedForm[] = [
  // ── HR: Leave Request ──────────────────────────────────────────────────────
  //
  // workflowEvent is a WORKFLOW HINT, not a bus event type.
  //
  // Why NOT "leave.requested":
  //   "leave.requested" is a canonical domain event (EVENT_TYPES.LEAVE_REQUESTED)
  //   with a typed payload (LeaveRequestedPayload) that requires structured fields:
  //   leaveRequestId, daysRequested (computed), camelCase field names.
  //   Emitting it from a generic form submission would be a contract violation -
  //   the generic form payload has snake_case fields, no leaveRequestId, no
  //   computed daysRequested.  TypeScript does not catch this because
  //   eventDispatcher.dispatch() accepts Record<string, unknown>.
  //
  //   When a dedicated /hr/leave-requests route exists, it will emit the proper
  //   leave.requested domain event.  Until then, "hr.form.submitted" is correct.
  //
  {
    name:          "Leave Request",
    nameAr:        "طلب إجازة",
    description:   "Submit a request for annual, sick, or other leave types",
    descriptionAr: "تقديم طلب إجازة سنوية أو مرضية أو غيرها",
    module:        "hr",
    category:      "leave",
    status:        "active",
    workflowEvent: "hr.form.submitted",
    fields: [
      {
        name: "leave_type", label: "Leave Type", labelAr: "نوع الإجازة",
        type: "dropdown", required: true, displayOrder: 0,
        options: [
          { value: "annual",    label: "Annual Leave",    labelAr: "إجازة سنوية" },
          { value: "sick",      label: "Sick Leave",      labelAr: "إجازة مرضية" },
          { value: "emergency", label: "Emergency Leave", labelAr: "إجازة طارئة" },
          { value: "unpaid",    label: "Unpaid Leave",    labelAr: "إجازة بدون راتب" },
          { value: "maternity", label: "Maternity Leave", labelAr: "إجازة أمومة" },
          { value: "other",     label: "Other",           labelAr: "أخرى" },
        ],
      },
      {
        name: "start_date", label: "Start Date", labelAr: "تاريخ البداية",
        type: "date", required: true, displayOrder: 1,
      },
      {
        name: "end_date", label: "End Date", labelAr: "تاريخ النهاية",
        type: "date", required: true, displayOrder: 2,
      },
      {
        name: "reason", label: "Reason", labelAr: "السبب",
        type: "textarea", required: false, displayOrder: 3,
        placeholder: "Optional: reason for leave request",
        placeholderAr: "اختياري: سبب طلب الإجازة",
        validation: { maxLength: 500 },
      },
      {
        name: "supporting_document", label: "Supporting Document", labelAr: "الوثيقة الداعمة",
        type: "file", required: false, displayOrder: 4,
        validation: { fileTypes: ["pdf", "jpg", "jpeg", "png"], maxFileSizeMb: 5 },
      },
    ],
  },

  // ── IT: Equipment Request ──────────────────────────────────────────────────
  {
    name:          "IT Equipment Request",
    nameAr:        "طلب معدات تقنية",
    description:   "Request laptops, peripherals, software licenses, or other IT equipment",
    descriptionAr: "طلب أجهزة، ملحقات، تراخيص برامج، أو أي معدات تقنية",
    module:        "system",
    category:      "it",
    status:        "active",
    workflowEvent: "system.form.submitted",
    fields: [
      {
        name: "equipment_type", label: "Equipment Type", labelAr: "نوع المعدة",
        type: "dropdown", required: true, displayOrder: 0,
        options: [
          { value: "laptop",    label: "Laptop",            labelAr: "حاسوب محمول" },
          { value: "monitor",   label: "Monitor",           labelAr: "شاشة" },
          { value: "keyboard",  label: "Keyboard & Mouse",  labelAr: "لوحة مفاتيح وماوس" },
          { value: "phone",     label: "Mobile Phone",      labelAr: "هاتف محمول" },
          { value: "software",  label: "Software License",  labelAr: "ترخيص برنامج" },
          { value: "other",     label: "Other",             labelAr: "أخرى" },
        ],
      },
      {
        name: "quantity", label: "Quantity", labelAr: "الكمية",
        type: "number", required: true, displayOrder: 1,
        defaultValue: "1", validation: { min: 1, max: 50 },
      },
      {
        name: "urgency", label: "Urgency", labelAr: "الأهمية",
        type: "radio", required: true, displayOrder: 2,
        options: [
          { value: "low",    label: "Low - within 2 weeks",  labelAr: "منخفضة - خلال أسبوعين" },
          { value: "medium", label: "Medium - within 1 week", labelAr: "متوسطة - خلال أسبوع" },
          { value: "high",   label: "High - within 2 days",  labelAr: "عالية - خلال يومين" },
        ],
      },
      {
        name: "justification", label: "Business Justification", labelAr: "المبرر التجاري",
        type: "textarea", required: true, displayOrder: 3,
        placeholder: "Explain why this equipment is needed",
        placeholderAr: "اشرح لماذا تحتاج هذا المعدة",
        validation: { minLength: 20, maxLength: 1000 },
      },
      {
        name: "preferred_specs", label: "Preferred Specs (optional)", labelAr: "المواصفات المفضلة",
        type: "textarea", required: false, displayOrder: 4,
        validation: { maxLength: 500 },
      },
    ],
  },

  // ── Finance: Expense Reimbursement ─────────────────────────────────────────
  //
  // workflowEvent is a WORKFLOW HINT, not a bus event type.
  //
  // Why NOT "approval.requested":
  //   "approval.requested" is a legacy name for the canonical domain event
  //   "approval.created" (ApprovalCreatedPayload).  That event requires a
  //   structured approvals DB record with approvalId, approverUserId, ticketId -
  //   none of which exist in a generic form submission.
  //
  //   The correct pattern for expense → approval flow:
  //     1. User submits this form → form.submitted emitted (generic).
  //     2. An admin or automated workflow creates an approval via POST /approvals.
  //     3. That route emits the proper approval.created domain event.
  //   This is a two-step saga, not a single form → domain-event shortcut.
  //
  {
    name:          "Expense Reimbursement",
    nameAr:        "طلب استرداد مصروف",
    description:   "Submit expenses for reimbursement",
    descriptionAr: "تقديم طلب استرداد المصروفات",
    module:        "approvals",
    category:      "hr",
    status:        "active",
    workflowEvent: "approvals.form.submitted",
    fields: [
      {
        name: "expense_category", label: "Category", labelAr: "الفئة",
        type: "dropdown", required: true, displayOrder: 0,
        options: [
          { value: "travel",        label: "Travel & Transport",   labelAr: "سفر ومواصلات" },
          { value: "meals",         label: "Meals & Entertainment", labelAr: "وجبات وترفيه" },
          { value: "office",        label: "Office Supplies",      labelAr: "مستلزمات مكتبية" },
          { value: "training",      label: "Training & Education",  labelAr: "تدريب وتعليم" },
          { value: "accommodation", label: "Accommodation",        labelAr: "إقامة" },
          { value: "other",         label: "Other",                labelAr: "أخرى" },
        ],
      },
      {
        name: "amount", label: "Amount (SAR)", labelAr: "المبلغ (ريال)",
        type: "number", required: true, displayOrder: 1,
        validation: { min: 1, max: 100000 },
      },
      {
        name: "expense_date", label: "Expense Date", labelAr: "تاريخ المصروف",
        type: "date", required: true, displayOrder: 2,
      },
      {
        name: "description", label: "Description", labelAr: "الوصف",
        type: "textarea", required: true, displayOrder: 3,
        placeholder: "Describe the expense and business purpose",
        placeholderAr: "صف المصروف والغرض التجاري منه",
        validation: { minLength: 10, maxLength: 500 },
      },
      {
        name: "receipt", label: "Receipt / Invoice", labelAr: "الإيصال / الفاتورة",
        type: "file", required: true, displayOrder: 4,
        validation: { fileTypes: ["pdf", "jpg", "jpeg", "png"], maxFileSizeMb: 10 },
      },
    ],
  },

  // ── General: Feedback / Suggestion ────────────────────────────────────────
  {
    name:          "Employee Feedback",
    nameAr:        "ملاحظات الموظف",
    description:   "Share suggestions, feedback, or report workplace issues",
    descriptionAr: "شارك اقتراحاتك أو ملاحظاتك أو أبلغ عن مشكلات في بيئة العمل",
    module:        "system",
    category:      "general",
    status:        "active",
    workflowEvent: "system.form.submitted",
    fields: [
      {
        name: "feedback_type", label: "Feedback Type", labelAr: "نوع الملاحظة",
        type: "radio", required: true, displayOrder: 0,
        options: [
          { value: "suggestion",  label: "Suggestion",       labelAr: "اقتراح" },
          { value: "complaint",   label: "Complaint",        labelAr: "شكوى" },
          { value: "recognition", label: "Peer Recognition", labelAr: "تقدير زميل" },
          { value: "general",     label: "General",          labelAr: "عام" },
        ],
      },
      {
        name: "subject", label: "Subject", labelAr: "الموضوع",
        type: "text", required: true, displayOrder: 1,
        validation: { minLength: 5, maxLength: 200 },
      },
      {
        name: "details", label: "Details", labelAr: "التفاصيل",
        type: "textarea", required: true, displayOrder: 2,
        validation: { minLength: 20, maxLength: 2000 },
      },
      {
        name: "anonymous", label: "Submit Anonymously", labelAr: "تقديم مجهول الهوية",
        type: "boolean", required: false, displayOrder: 3,
        defaultValue: "false",
      },
      {
        name: "attachment", label: "Attachment (optional)", labelAr: "مرفق (اختياري)",
        type: "file", required: false, displayOrder: 4,
        validation: { maxFileSizeMb: 10 },
      },
    ],
  },
];

export async function seedFormTemplates() {
  const workspaces = await db.select({ id: workspacesTable.id }).from(workspacesTable);

  for (const workspace of workspaces) {
    for (const template of SEED_FORMS) {
      // Check if this form already exists for this workspace
      const [existing] = await db
        .select({ cnt: count() })
        .from(formDefinitionsTable)
        .where(
          and(
            eq(formDefinitionsTable.workspaceId, workspace.id),
            eq(formDefinitionsTable.name, template.name),
          ),
        );

      if ((existing?.cnt ?? 0) > 0) continue;

      const [form] = await db
        .insert(formDefinitionsTable)
        .values({
          workspaceId:   workspace.id,
          name:          template.name,
          nameAr:        template.nameAr,
          description:   template.description,
          descriptionAr: template.descriptionAr,
          module:        template.module,
          category:      template.category,
          status:        template.status,
          workflowEvent: template.workflowEvent,
        })
        .returning({ id: formDefinitionsTable.id });

      if (!form) continue;

      await db.insert(formFieldsTable).values(
        template.fields.map((f) => ({
          formId:        form.id,
          name:          f.name,
          label:         f.label,
          labelAr:       f.labelAr ?? null,
          type:          f.type,
          required:      f.required,
          placeholder:   f.placeholder ?? null,
          placeholderAr: f.placeholderAr ?? null,
          defaultValue:  f.defaultValue ?? null,
          options:       f.options ?? null,
          validation:    f.validation ?? null,
          displayOrder:  f.displayOrder,
        })),
      );
    }
  }

  logger.info("Form templates seeded");
}
