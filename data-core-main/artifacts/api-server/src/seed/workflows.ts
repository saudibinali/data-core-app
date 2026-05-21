/**
 * Workflow seed - creates example workflows for every workspace that has none.
 * Called at server startup after modules are seeded.
 */
import { db } from "@workspace/db";
import { workflowDefinitionsTable, workspacesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import type { WorkflowStep } from "../lib/workflows/types";

const TEMPLATE_WORKFLOWS: Array<{
  key: string;
  name: string;
  nameAr: string;
  description: string;
  descriptionAr: string;
  module: string;
  triggerEvent: string;
  steps: WorkflowStep[];
}> = [
  // ── 1. Employee Onboarding ─────────────────────────────────────────────────
  {
    key: "employee_onboarding",
    name: "Employee Onboarding",
    nameAr: "تأهيل الموظف الجديد",
    description: "Automatically create IT setup task and notify the manager when a new employee is added.",
    descriptionAr: "إنشاء مهمة الإعداد التقني وإخطار المدير تلقائياً عند إضافة موظف جديد.",
    module: "users",
    triggerEvent: "employee.created",
    steps: [
      {
        index: 0,
        type: "task",
        name: "Create IT Setup Task",
        config: {
          title: "IT Onboarding Setup",
          description: "Set up laptop, accounts, and system access for new employee.",
          assigneeType: "role",
          assigneeRole: "admin",
          priority: "high",
          dueDays: 3,
        },
      } satisfies WorkflowStep,
      {
        index: 1,
        type: "notification",
        name: "Notify Manager",
        config: {
          recipientType: "manager",
          title: "New Employee Joined",
          titleAr: "انضم موظف جديد",
          message: "A new employee has been added to the system. Please review their onboarding checklist.",
          messageAr: "تمت إضافة موظف جديد إلى النظام. يرجى مراجعة قائمة التأهيل.",
          link: "/users",
        },
      } satisfies WorkflowStep,
      {
        index: 2,
        type: "notification",
        name: "Welcome Notification",
        config: {
          recipientType: "creator",
          title: "New Employee Added Successfully",
          titleAr: "تمت إضافة الموظف بنجاح",
          message: "The employee has been added and an IT setup task has been created.",
          messageAr: "تمت إضافة الموظف وتم إنشاء مهمة الإعداد التقني.",
          link: "/users",
        },
      } satisfies WorkflowStep,
    ],
  },

  // ── 2. Ticket Escalation ───────────────────────────────────────────────────
  {
    key: "ticket_high_priority_notification",
    name: "High Priority Ticket Alert",
    nameAr: "تنبيه التذاكر ذات الأولوية العالية",
    description: "Notify admin when a high or urgent priority ticket is created.",
    descriptionAr: "إخطار المشرف عند إنشاء تذكرة ذات أولوية عالية أو عاجلة.",
    module: "tickets",
    triggerEvent: "ticket.created",
    steps: [
      {
        index: 0,
        type: "condition",
        name: "Check Priority",
        config: {
          conditions: {
            logic: "or",
            conditions: [
              { field: "priority", operator: "eq", value: "high" },
              { field: "priority", operator: "eq", value: "urgent" },
            ],
          },
          onTrueStepIndex:  1,
          onFalseStepIndex: null,
        },
      } satisfies WorkflowStep,
      {
        index: 1,
        type: "notification",
        name: "Notify Admin",
        config: {
          recipientType: "role",
          recipientRole: "admin",
          title: "High Priority Ticket Created",
          titleAr: "تم إنشاء تذكرة عالية الأولوية",
          message: "A high or urgent priority ticket has been created and requires immediate attention.",
          messageAr: "تم إنشاء تذكرة عالية الأولوية أو عاجلة وتتطلب اهتماماً فورياً.",
          link: "/tickets",
        },
      } satisfies WorkflowStep,
    ],
  },

  // ── 3. Leave request — manager approval (HCM W1) ───────────────────────────
  {
    key: "leave_request_manager_approval",
    name: "Leave Request — Manager Approval",
    nameAr: "طلب إجازة — موافقة المدير",
    description: "Route leave requests to the employee's manager for approval.",
    descriptionAr: "توجيه طلبات الإجازة إلى المدير المباشر للموافقة.",
    module: "hr",
    triggerEvent: "leave.requested",
    steps: [
      {
        index: 0,
        type: "approval",
        name: "Manager Approval",
        config: {
          approvalType: "single",
          approverType: "manager",
          title: "Leave Request Approval",
          timeoutHours: 72,
          onTimeout: "escalate",
        },
      } satisfies WorkflowStep,
      {
        index: 1,
        type: "notification",
        name: "Notify HR",
        config: {
          recipientType: "role",
          recipientRole: "admin",
          title: "Leave Request Submitted",
          titleAr: "طلب إجازة مُقدَّم",
          message: "A leave request is awaiting approval in the approvals queue.",
          messageAr: "طلب إجازة بانتظار الموافقة في قائمة الموافقات.",
          link: "/approvals",
        },
      } satisfies WorkflowStep,
    ],
  },

  // ── 4. Payroll run — review gate (HCM W1) ──────────────────────────────────
  {
    key: "payroll_run_review_notify",
    name: "Payroll Run — Review Notification",
    nameAr: "دورة رواتب — إشعار المراجعة",
    description: "Notify payroll administrators when a run enters review.",
    descriptionAr: "إخطار مسؤولي الرواتب عند دخول الدورة مرحلة المراجعة.",
    module: "hr",
    triggerEvent: "payroll.run.review",
    steps: [
      {
        index: 0,
        type: "notification",
        name: "Notify Payroll Admin",
        config: {
          recipientType: "role",
          recipientRole: "admin",
          title: "Payroll Run Ready for Review",
          titleAr: "دورة رواتب جاهزة للمراجعة",
          message: "A payroll run requires review before approval and payslip issuance.",
          messageAr: "دورة رواتب تحتاج مراجعة قبل الاعتماد وإصدار القسائم.",
          link: "/admin/hr/payroll",
        },
      } satisfies WorkflowStep,
    ],
  },

  // ── 5. Ticket Closure Confirmation ────────────────────────────────────────
  {
    key: "ticket_closed_creator_notify",
    name: "Ticket Closed - Notify Creator",
    nameAr: "إغلاق التذكرة - إخطار المنشئ",
    description: "Send a notification to the ticket creator when their ticket is closed.",
    descriptionAr: "إرسال إشعار لمنشئ التذكرة عند إغلاقها.",
    module: "tickets",
    triggerEvent: "ticket.closed",
    steps: [
      {
        index: 0,
        type: "notification",
        name: "Notify Ticket Creator",
        config: {
          recipientType: "creator",
          title: "Your Ticket Has Been Closed",
          titleAr: "تم إغلاق تذكرتك",
          message: "Your support ticket has been resolved and closed. Thank you for your patience.",
          messageAr: "تم حل تذكرة الدعم الخاصة بك وإغلاقها. شكراً لصبرك.",
          link: "/tickets",
        },
      } satisfies WorkflowStep,
    ],
  },
];

export async function seedWorkflowTemplates(): Promise<void> {
  const workspaces = await db
    .select({ id: workspacesTable.id })
    .from(workspacesTable);

  for (const ws of workspaces) {
    for (const template of TEMPLATE_WORKFLOWS) {
      const [existing] = await db
        .select({ id: workflowDefinitionsTable.id })
        .from(workflowDefinitionsTable)
        .where(
          sql`${workflowDefinitionsTable.workspaceId} = ${ws.id}
              AND ${workflowDefinitionsTable.key} = ${template.key}`,
        )
        .limit(1);

      if (existing) continue;

      await db.insert(workflowDefinitionsTable).values({
        workspaceId: ws.id,
        key: template.key,
        name: template.name,
        nameAr: template.nameAr,
        description: template.description,
        descriptionAr: template.descriptionAr,
        module: template.module,
        triggerEvent: template.triggerEvent,
        conditions: [],
        steps: template.steps as unknown as Record<string, unknown>[],
        isActive: true,
        status: "active",
      });

      logger.info(
        { workspaceId: ws.id, key: template.key },
        "Workflow template seeded",
      );
    }
  }
}
