import { db } from "@workspace/db";
import { platformEventRegistryTable } from "@workspace/db";
import { sql } from "drizzle-orm";

// ── Rich field type system ────────────────────────────────────────────────────
// This is the canonical definition of how each field in an event should be
// presented in the workflow builder UI. The DB stores this as JSONB in `schema`.

type Operator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "starts_with" | "in" | "not_in";

export interface EventFieldDef {
  name: string;
  label: string;
  labelAr: string;
  type: "text" | "number" | "boolean" | "enum" | "user" | "department" | "date";
  operators: Operator[];
  enumValues?: { value: string; label: string; labelAr: string }[];
  description?: string;
}

export interface EventSchema {
  fields: EventFieldDef[];
}

// ── Shared operator sets per type ────────────────────────────────────────────
const TEXT_OPS:       Operator[] = ["eq", "neq", "contains", "starts_with"];
const NUMBER_OPS:     Operator[] = ["eq", "neq", "gt", "gte", "lt", "lte"];
const ENUM_OPS:       Operator[] = ["eq", "neq", "in", "not_in"];
const BOOL_OPS:       Operator[] = ["eq"];
const ENTITY_OPS:     Operator[] = ["eq", "neq", "in", "not_in"];
const DATE_OPS:       Operator[] = ["eq", "neq", "gt", "gte", "lt", "lte"];

// ── Reusable field definitions ───────────────────────────────────────────────
const PRIORITY_FIELD: EventFieldDef = {
  name: "priority",
  label: "Priority",
  labelAr: "الأولوية",
  type: "enum",
  operators: ENUM_OPS,
  enumValues: [
    { value: "low",    label: "Low",    labelAr: "منخفضة" },
    { value: "medium", label: "Medium", labelAr: "متوسطة" },
    { value: "high",   label: "High",   labelAr: "عالية" },
    { value: "urgent", label: "Urgent", labelAr: "عاجلة" },
  ],
};

const TICKET_STATUS_FIELD: EventFieldDef = {
  name: "status",
  label: "Status",
  labelAr: "الحالة",
  type: "enum",
  operators: ENUM_OPS,
  enumValues: [
    { value: "open",        label: "Open",        labelAr: "مفتوحة" },
    { value: "in_progress", label: "In Progress",  labelAr: "قيد التنفيذ" },
    { value: "pending",     label: "Pending",      labelAr: "معلقة" },
    { value: "resolved",    label: "Resolved",     labelAr: "محلولة" },
    { value: "closed",      label: "Closed",       labelAr: "مغلقة" },
  ],
};

const ASSIGNEE_FIELD: EventFieldDef = {
  name: "assigneeId",
  label: "Assignee",
  labelAr: "المسؤول",
  type: "user",
  operators: ENTITY_OPS,
};

const DEPARTMENT_FIELD: EventFieldDef = {
  name: "departmentId",
  label: "Department",
  labelAr: "القسم",
  type: "department",
  operators: ENTITY_OPS,
};

const TITLE_FIELD: EventFieldDef = {
  name: "title",
  label: "Title",
  labelAr: "العنوان",
  type: "text",
  operators: TEXT_OPS,
};

const ROLE_FIELD: EventFieldDef = {
  name: "role",
  label: "Role",
  labelAr: "الدور",
  type: "enum",
  operators: ENUM_OPS,
  enumValues: [
    { value: "admin",   label: "Admin",   labelAr: "مدير" },
    { value: "manager", label: "Manager", labelAr: "مشرف" },
    { value: "member",  label: "Member",  labelAr: "عضو" },
  ],
};

const REQUESTER_FIELD: EventFieldDef = {
  name: "requesterId",
  label: "Requester",
  labelAr: "مقدم الطلب",
  type: "user",
  operators: ENTITY_OPS,
};

const APPROVER_FIELD: EventFieldDef = {
  name: "approverId",
  label: "Approver",
  labelAr: "المعتمِد",
  type: "user",
  operators: ENTITY_OPS,
};

const AUTHOR_FIELD: EventFieldDef = {
  name: "authorId",
  label: "Author",
  labelAr: "الكاتب",
  type: "user",
  operators: ENTITY_OPS,
};

// ── Approval type shared ─────────────────────────────────────────────────────
const APPROVAL_TYPE_FIELD: EventFieldDef = {
  name: "type",
  label: "Approval Type",
  labelAr: "نوع الموافقة",
  type: "enum",
  operators: ENUM_OPS,
  enumValues: [
    { value: "leave",    label: "Leave",    labelAr: "إجازة" },
    { value: "expense",  label: "Expense",  labelAr: "مصروف" },
    { value: "purchase", label: "Purchase", labelAr: "مشتريات" },
    { value: "other",    label: "Other",    labelAr: "أخرى" },
  ],
};

// ── Event definitions ─────────────────────────────────────────────────────────
interface EventDefinition {
  eventName: string;
  module: string;
  description: string;
  descriptionAr: string;
  schema: EventSchema;
}

const REGISTRY: EventDefinition[] = [

  // ── Employees ───────────────────────────────────────────────────────────────
  {
    eventName: "employee.created",
    module: "users",
    description: "Fired when a new employee account is created",
    descriptionAr: "يُطلق عند إنشاء حساب موظف جديد",
    schema: {
      fields: [
        ROLE_FIELD,
        DEPARTMENT_FIELD,
        {
          name: "employeeNumber",
          label: "Employee Number",
          labelAr: "رقم الموظف",
          type: "text",
          operators: TEXT_OPS,
        },
      ],
    },
  },

  {
    eventName: "employee.updated",
    module: "users",
    description: "Fired when an employee profile is updated",
    descriptionAr: "يُطلق عند تحديث ملف الموظف",
    schema: {
      fields: [
        ROLE_FIELD,
        DEPARTMENT_FIELD,
        {
          name: "employeeNumber",
          label: "Employee Number",
          labelAr: "رقم الموظف",
          type: "text",
          operators: TEXT_OPS,
        },
      ],
    },
  },

  {
    eventName: "employee.deleted",
    module: "users",
    description: "Fired when an employee account is removed",
    descriptionAr: "يُطلق عند حذف حساب موظف",
    schema: {
      fields: [
        {
          name: "employeeNumber",
          label: "Employee Number",
          labelAr: "رقم الموظف",
          type: "text",
          operators: TEXT_OPS,
        },
      ],
    },
  },

  {
    eventName: "employee.resigned",
    module: "users",
    description: "Fired when an employee resigns or is offboarded",
    descriptionAr: "يُطلق عند استقالة أو إنهاء خدمة موظف",
    schema: {
      fields: [
        {
          name: "effectiveDate",
          label: "Effective Date",
          labelAr: "تاريخ السريان",
          type: "date",
          operators: DATE_OPS,
        },
        DEPARTMENT_FIELD,
      ],
    },
  },

  // ── Tickets ─────────────────────────────────────────────────────────────────
  {
    eventName: "ticket.created",
    module: "tickets",
    description: "Fired when a new ticket is created",
    descriptionAr: "يُطلق عند إنشاء تذكرة جديدة",
    schema: {
      fields: [
        TITLE_FIELD,
        PRIORITY_FIELD,
        TICKET_STATUS_FIELD,
        ASSIGNEE_FIELD,
        DEPARTMENT_FIELD,
        {
          name: "ticketType",
          label: "Ticket Type",
          labelAr: "نوع التذكرة",
          type: "enum",
          operators: ENUM_OPS,
          enumValues: [
            { value: "bug",      label: "Bug",      labelAr: "خطأ" },
            { value: "feature",  label: "Feature",  labelAr: "ميزة" },
            { value: "support",  label: "Support",  labelAr: "دعم" },
            { value: "task",     label: "Task",     labelAr: "مهمة" },
            { value: "other",    label: "Other",    labelAr: "أخرى" },
          ],
        },
        {
          name: "category",
          label: "Category",
          labelAr: "الفئة",
          type: "text",
          operators: TEXT_OPS,
        },
      ],
    },
  },

  {
    eventName: "ticket.updated",
    module: "tickets",
    description: "Fired when a ticket is updated",
    descriptionAr: "يُطلق عند تحديث تذكرة",
    schema: {
      fields: [
        TITLE_FIELD,
        PRIORITY_FIELD,
        TICKET_STATUS_FIELD,
        ASSIGNEE_FIELD,
        DEPARTMENT_FIELD,
        {
          name: "ticketType",
          label: "Ticket Type",
          labelAr: "نوع التذكرة",
          type: "enum",
          operators: ENUM_OPS,
          enumValues: [
            { value: "bug",      label: "Bug",      labelAr: "خطأ" },
            { value: "feature",  label: "Feature",  labelAr: "ميزة" },
            { value: "support",  label: "Support",  labelAr: "دعم" },
            { value: "task",     label: "Task",     labelAr: "مهمة" },
            { value: "other",    label: "Other",    labelAr: "أخرى" },
          ],
        },
      ],
    },
  },

  {
    eventName: "ticket.closed",
    module: "tickets",
    description: "Fired when a ticket is closed or resolved",
    descriptionAr: "يُطلق عند إغلاق أو حل تذكرة",
    schema: {
      fields: [
        PRIORITY_FIELD,
        ASSIGNEE_FIELD,
        DEPARTMENT_FIELD,
        {
          name: "resolution",
          label: "Resolution",
          labelAr: "القرار",
          type: "text",
          operators: TEXT_OPS,
        },
        {
          name: "hadEscalation",
          label: "Was Escalated",
          labelAr: "هل تم التصعيد",
          type: "boolean",
          operators: BOOL_OPS,
        },
      ],
    },
  },

  {
    eventName: "ticket.commented",
    module: "tickets",
    description: "Fired when a comment is added to a ticket",
    descriptionAr: "يُطلق عند إضافة تعليق على تذكرة",
    schema: {
      fields: [
        AUTHOR_FIELD,
        PRIORITY_FIELD,
        TICKET_STATUS_FIELD,
      ],
    },
  },

  // ── Approvals ────────────────────────────────────────────────────────────────
  {
    eventName: "approval.requested",
    module: "approvals",
    description: "Fired when an approval is requested",
    descriptionAr: "يُطلق عند طلب موافقة",
    schema: {
      fields: [
        APPROVAL_TYPE_FIELD,
        REQUESTER_FIELD,
        DEPARTMENT_FIELD,
      ],
    },
  },

  {
    eventName: "approval.approved",
    module: "approvals",
    description: "Fired when an approval is granted",
    descriptionAr: "يُطلق عند منح الموافقة",
    schema: {
      fields: [
        APPROVAL_TYPE_FIELD,
        APPROVER_FIELD,
        REQUESTER_FIELD,
      ],
    },
  },

  {
    eventName: "approval.rejected",
    module: "approvals",
    description: "Fired when an approval is rejected",
    descriptionAr: "يُطلق عند رفض الموافقة",
    schema: {
      fields: [
        APPROVAL_TYPE_FIELD,
        APPROVER_FIELD,
        REQUESTER_FIELD,
        {
          name: "reason",
          label: "Rejection Reason",
          labelAr: "سبب الرفض",
          type: "text",
          operators: TEXT_OPS,
        },
      ],
    },
  },

  // ── Departments ──────────────────────────────────────────────────────────────
  {
    eventName: "department.created",
    module: "departments",
    description: "Fired when a new department is created",
    descriptionAr: "يُطلق عند إنشاء قسم جديد",
    schema: {
      fields: [
        {
          name: "name",
          label: "Department Name",
          labelAr: "اسم القسم",
          type: "text",
          operators: TEXT_OPS,
        },
        {
          name: "managerId",
          label: "Manager",
          labelAr: "المدير",
          type: "user",
          operators: ENTITY_OPS,
        },
      ],
    },
  },

  {
    eventName: "department.updated",
    module: "departments",
    description: "Fired when a department is updated",
    descriptionAr: "يُطلق عند تحديث قسم",
    schema: {
      fields: [
        DEPARTMENT_FIELD,
        {
          name: "name",
          label: "Department Name",
          labelAr: "اسم القسم",
          type: "text",
          operators: TEXT_OPS,
        },
      ],
    },
  },

  // ── Groups ───────────────────────────────────────────────────────────────────
  {
    eventName: "group.created",
    module: "groups",
    description: "Fired when a new group is created",
    descriptionAr: "يُطلق عند إنشاء مجموعة جديدة",
    schema: {
      fields: [
        {
          name: "name",
          label: "Group Name",
          labelAr: "اسم المجموعة",
          type: "text",
          operators: TEXT_OPS,
        },
      ],
    },
  },

  {
    eventName: "group.member_added",
    module: "groups",
    description: "Fired when a member is added to a group",
    descriptionAr: "يُطلق عند إضافة عضو إلى مجموعة",
    schema: {
      fields: [
        {
          name: "userId",
          label: "Added User",
          labelAr: "المستخدم المضاف",
          type: "user",
          operators: ENTITY_OPS,
        },
      ],
    },
  },

  // ── Leave ────────────────────────────────────────────────────────────────────
  {
    eventName: "leave.requested",
    module: "hr",
    description: "Fired when a leave request is submitted",
    descriptionAr: "يُطلق عند تقديم طلب إجازة",
    schema: {
      fields: [
        {
          name: "employeeId",
          label: "Employee",
          labelAr: "الموظف",
          type: "user",
          operators: ENTITY_OPS,
        },
        DEPARTMENT_FIELD,
        {
          name: "leaveType",
          label: "Leave Type",
          labelAr: "نوع الإجازة",
          type: "enum",
          operators: ENUM_OPS,
          enumValues: [
            { value: "annual",   label: "Annual",   labelAr: "سنوية" },
            { value: "sick",     label: "Sick",     labelAr: "مرضية" },
            { value: "unpaid",   label: "Unpaid",   labelAr: "بدون راتب" },
            { value: "maternity",label: "Maternity",labelAr: "أمومة" },
            { value: "other",    label: "Other",    labelAr: "أخرى" },
          ],
        },
        {
          name: "startDate",
          label: "Start Date",
          labelAr: "تاريخ البداية",
          type: "date",
          operators: DATE_OPS,
        },
        {
          name: "endDate",
          label: "End Date",
          labelAr: "تاريخ النهاية",
          type: "date",
          operators: DATE_OPS,
        },
      ],
    },
  },

  {
    eventName: "leave.approved",
    module: "hr",
    description: "Fired when a leave request is finally approved (all steps complete)",
    descriptionAr: "يُطلق عند الموافقة النهائية على طلب إجازة",
    schema: {
      fields: [
        {
          name: "employeeUserId",
          label: "Employee",
          labelAr: "الموظف",
          type: "user",
          operators: ENTITY_OPS,
        },
        DEPARTMENT_FIELD,
        {
          name: "leaveType",
          label: "Leave Type",
          labelAr: "نوع الإجازة",
          type: "enum",
          operators: ENUM_OPS,
          enumValues: [
            { value: "annual",    label: "Annual",    labelAr: "سنوية" },
            { value: "sick",      label: "Sick",      labelAr: "مرضية" },
            { value: "unpaid",    label: "Unpaid",    labelAr: "بدون راتب" },
            { value: "maternity", label: "Maternity", labelAr: "أمومة" },
            { value: "emergency", label: "Emergency", labelAr: "طارئة" },
            { value: "other",     label: "Other",     labelAr: "أخرى" },
          ],
        },
        {
          name: "approvedByUserId",
          label: "Approved By",
          labelAr: "تمت الموافقة بواسطة",
          type: "user",
          operators: ENTITY_OPS,
        },
      ],
    },
  },

  {
    eventName: "leave.rejected",
    module: "hr",
    description: "Fired when a leave request is rejected by an approver",
    descriptionAr: "يُطلق عند رفض طلب إجازة من قِبَل مسؤول",
    schema: {
      fields: [
        {
          name: "employeeUserId",
          label: "Employee",
          labelAr: "الموظف",
          type: "user",
          operators: ENTITY_OPS,
        },
        DEPARTMENT_FIELD,
        {
          name: "leaveType",
          label: "Leave Type",
          labelAr: "نوع الإجازة",
          type: "enum",
          operators: ENUM_OPS,
          enumValues: [
            { value: "annual",    label: "Annual",    labelAr: "سنوية" },
            { value: "sick",      label: "Sick",      labelAr: "مرضية" },
            { value: "unpaid",    label: "Unpaid",    labelAr: "بدون راتب" },
            { value: "maternity", label: "Maternity", labelAr: "أمومة" },
            { value: "emergency", label: "Emergency", labelAr: "طارئة" },
            { value: "other",     label: "Other",     labelAr: "أخرى" },
          ],
        },
        {
          name: "rejectedByUserId",
          label: "Rejected By",
          labelAr: "تم الرفض بواسطة",
          type: "user",
          operators: ENTITY_OPS,
        },
      ],
    },
  },

  {
    eventName: "leave.cancelled",
    module: "hr",
    description: "Fired when an approved or pending leave is cancelled by HR/admin",
    descriptionAr: "يُطلق عند إلغاء إجازة موافق عليها أو معلقة بواسطة مسؤول HR",
    schema: {
      fields: [
        {
          name: "employeeUserId",
          label: "Employee",
          labelAr: "الموظف",
          type: "user",
          operators: ENTITY_OPS,
        },
        DEPARTMENT_FIELD,
        {
          name: "leaveType",
          label: "Leave Type",
          labelAr: "نوع الإجازة",
          type: "enum",
          operators: ENUM_OPS,
          enumValues: [
            { value: "annual",    label: "Annual",    labelAr: "سنوية" },
            { value: "sick",      label: "Sick",      labelAr: "مرضية" },
            { value: "unpaid",    label: "Unpaid",    labelAr: "بدون راتب" },
            { value: "maternity", label: "Maternity", labelAr: "أمومة" },
            { value: "emergency", label: "Emergency", labelAr: "طارئة" },
            { value: "other",     label: "Other",     labelAr: "أخرى" },
          ],
        },
        {
          name: "cancelledByUserId",
          label: "Cancelled By",
          labelAr: "تم الإلغاء بواسطة",
          type: "user",
          operators: ENTITY_OPS,
        },
        {
          name: "wasApproved",
          label: "Was Previously Approved",
          labelAr: "كان موافقاً عليها مسبقاً",
          type: "boolean",
          operators: BOOL_OPS,
        },
      ],
    },
  },

  {
    eventName: "leave.withdrawn",
    module: "hr",
    description: "Fired when an employee withdraws their own pending leave request",
    descriptionAr: "يُطلق عند سحب الموظف لطلب إجازته المعلق",
    schema: {
      fields: [
        {
          name: "employeeUserId",
          label: "Employee",
          labelAr: "الموظف",
          type: "user",
          operators: ENTITY_OPS,
        },
        DEPARTMENT_FIELD,
        {
          name: "leaveType",
          label: "Leave Type",
          labelAr: "نوع الإجازة",
          type: "enum",
          operators: ENUM_OPS,
          enumValues: [
            { value: "annual",    label: "Annual",    labelAr: "سنوية" },
            { value: "sick",      label: "Sick",      labelAr: "مرضية" },
            { value: "unpaid",    label: "Unpaid",    labelAr: "بدون راتب" },
            { value: "maternity", label: "Maternity", labelAr: "أمومة" },
            { value: "emergency", label: "Emergency", labelAr: "طارئة" },
            { value: "other",     label: "Other",     labelAr: "أخرى" },
          ],
        },
      ],
    },
  },

  {
    eventName: "leave.balance_adjusted",
    module: "hr",
    description: "Fired when HR manually adjusts an employee leave balance",
    descriptionAr: "يُطلق عند تعديل رصيد إجازة موظف يدوياً بواسطة مسؤول HR",
    schema: {
      fields: [
        {
          name: "employeeUserId",
          label: "Employee",
          labelAr: "الموظف",
          type: "user",
          operators: ENTITY_OPS,
        },
        {
          name: "leaveType",
          label: "Leave Type",
          labelAr: "نوع الإجازة",
          type: "enum",
          operators: ENUM_OPS,
          enumValues: [
            { value: "annual",    label: "Annual",    labelAr: "سنوية" },
            { value: "sick",      label: "Sick",      labelAr: "مرضية" },
            { value: "unpaid",    label: "Unpaid",    labelAr: "بدون راتب" },
            { value: "maternity", label: "Maternity", labelAr: "أمومة" },
            { value: "emergency", label: "Emergency", labelAr: "طارئة" },
            { value: "other",     label: "Other",     labelAr: "أخرى" },
          ],
        },
        {
          name: "adjustmentDays",
          label: "Adjustment (days)",
          labelAr: "التعديل (أيام)",
          type: "number",
          operators: NUMBER_OPS,
        },
        {
          name: "adjustedByUserId",
          label: "Adjusted By",
          labelAr: "تم التعديل بواسطة",
          type: "user",
          operators: ENTITY_OPS,
        },
      ],
    },
  },

  // ── Calendar ─────────────────────────────────────────────────────────────────
  {
    eventName: "meeting.created",
    module: "calendar",
    description: "Fired when a meeting or calendar event is created",
    descriptionAr: "يُطلق عند إنشاء اجتماع أو حدث في التقويم",
    schema: {
      fields: [
        TITLE_FIELD,
        {
          name: "organizerId",
          label: "Organizer",
          labelAr: "المنظِّم",
          type: "user",
          operators: ENTITY_OPS,
        },
        DEPARTMENT_FIELD,
      ],
    },
  },

  {
    eventName: "meeting.updated",
    module: "calendar",
    description: "Fired when a meeting is updated",
    descriptionAr: "يُطلق عند تحديث اجتماع",
    schema: {
      fields: [
        TITLE_FIELD,
        {
          name: "organizerId",
          label: "Organizer",
          labelAr: "المنظِّم",
          type: "user",
          operators: ENTITY_OPS,
        },
      ],
    },
  },

  // ── Forms ────────────────────────────────────────────────────────────────────
  {
    eventName: "forms.form.submitted",
    module: "forms",
    description: "Fired when any form is submitted (any module)",
    descriptionAr: "يُطلق عند تقديم أي نموذج",
    schema: {
      fields: [
        {
          name: "formId",
          label: "Form",
          labelAr: "النموذج",
          type: "number" as const,
          operators: NUMBER_OPS,
        },
        {
          name: "formName",
          label: "Form Name",
          labelAr: "اسم النموذج",
          type: "text" as const,
          operators: TEXT_OPS,
        },
        {
          name: "module",
          label: "Module",
          labelAr: "الوحدة",
          type: "text" as const,
          operators: TEXT_OPS,
        },
        DEPARTMENT_FIELD,
      ],
    },
  },
  // ── BUG-001 FIX (Cleanup Sprint) ──────────────────────────────────────────────
  // "leave.requested" was registered TWICE: once under module "hr" (above, line ~472)
  // and once here under module "forms" with a different schema (field name "leave_type"
  // vs "leaveType", missing startDate/endDate, extra "emergency" enum value).
  //
  // Root cause: copy-paste error when the forms-based leave workflow was added.
  // The forms entry had schema drift vs. the canonical hr entry and was creating
  // a duplicate key in platformEventRegistryTable on seeding.
  //
  // Resolution: the DUPLICATE "forms" entry has been REMOVED.
  // Canonical owner: module "hr" (entry above).
  //
  // The "forms.form.submitted" event (above) already covers generic form submissions
  // from the forms module - including leave-request forms submitted via the form
  // builder.  "leave.requested" is an HR domain event, not a forms event.
  //
  // If a leave-request form submission needs both events, the forms route should
  // emit form.submitted (generic) and the HR route should emit leave.requested
  // (domain-specific) - never a single event registered under two modules.

  // ── System ───────────────────────────────────────────────────────────────────
  {
    eventName: "user.logged_in",
    module: "system",
    description: "Fired when a user signs in to the platform",
    descriptionAr: "يُطلق عند تسجيل دخول مستخدم للمنصة",
    schema: {
      fields: [
        ROLE_FIELD,
        DEPARTMENT_FIELD,
        {
          name: "isFirstLogin",
          label: "First Login",
          labelAr: "أول تسجيل دخول",
          type: "boolean",
          operators: BOOL_OPS,
        },
      ],
    },
  },
];

export async function seedEventRegistry() {
  for (const entry of REGISTRY) {
    await db
      .insert(platformEventRegistryTable)
      .values(entry)
      .onConflictDoUpdate({
        target: platformEventRegistryTable.eventName,
        set: {
          module:       sql`excluded.module`,
          description:  sql`excluded.description`,
          descriptionAr: sql`excluded.description_ar`,
          schema:       sql`excluded.schema`,
        },
      });
  }
}
