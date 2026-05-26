import {
  pgTable, text, serial, integer, jsonb, boolean,
  timestamp, date, index, uniqueIndex, primaryKey,
} from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./users";
import { departmentsTable } from "./departments";
import { formDefinitionsTable } from "./forms";

// ─────────────────────────────────────────────────────────────────────────────
// ORGANIZATIONAL HIERARCHY
// company → branch → division → department → team
// Each org unit has an optional parentId (self-referential tree).
// ─────────────────────────────────────────────────────────────────────────────

export const hrOrgUnitsTable = pgTable(
  "hr_org_units",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),

    // company | branch | division | department | team
    type: text("type").notNull().default("department"),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    code: text("code"),                          // short code, e.g. "IT-001"
    parentId: integer("parent_id"),              // self-ref; set after insert
    managerEmployeeId: integer("manager_employee_id"), // org unit head (employee FK)
    color: text("color").notNull().default("#6366f1"),
    displayOrder: integer("display_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_hr_org_units_workspace").on(t.workspaceId),
    index("idx_hr_org_units_parent").on(t.parentId),
    index("idx_hr_org_units_type").on(t.type),
    index("idx_hr_org_units_manager_employee").on(t.managerEmployeeId),
    uniqueIndex("uq_hr_org_units_ws_code").on(t.workspaceId, t.code),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// JOB GRADES  (e.g. G1-G12, Band A-E)
// ─────────────────────────────────────────────────────────────────────────────

export const hrJobGradesTable = pgTable(
  "hr_job_grades",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),

    name: text("name").notNull(),               // e.g. "Grade 5"
    nameAr: text("name_ar"),
    code: text("code"),                         // e.g. "G5"
    level: integer("level"),                    // numeric ordering
    description: text("description"),
    displayOrder: integer("display_order").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_hr_job_grades_workspace").on(t.workspaceId),
    uniqueIndex("uq_hr_job_grades_ws_code").on(t.workspaceId, t.code),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// JOB TITLES
// ─────────────────────────────────────────────────────────────────────────────

export const hrJobTitlesTable = pgTable(
  "hr_job_titles",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    nameAr: text("name_ar"),
    code: text("code"),
    gradeId: integer("grade_id").references(() => hrJobGradesTable.id, { onDelete: "set null" }),
    description: text("description"),
    displayOrder: integer("display_order").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_hr_job_titles_workspace").on(t.workspaceId),
    uniqueIndex("uq_hr_job_titles_ws_code").on(t.workspaceId, t.code),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// WORK LOCATIONS  (office / remote / hybrid / field)
// Defined here so employeesTable can reference it.
// ─────────────────────────────────────────────────────────────────────────────

export const hrWorkLocationsTable = pgTable(
  "hr_work_locations",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    code: text("code"),
    // office | remote | hybrid | field
    type: text("type").notNull().default("office"),
    address: text("address"),
    city: text("city"),
    country: text("country"),
    timezone: text("timezone"),
    isActive: boolean("is_active").notNull().default(true),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_hr_work_locations_workspace").on(t.workspaceId),
    index("idx_hr_work_locations_type").on(t.type),
    uniqueIndex("uq_hr_work_locations_ws_code").on(t.workspaceId, t.code),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// POSITIONS  (actual seats in the org chart - distinct from Job Titles)
// "مهندس شبكات" = Job Title  |  "مهندس شبكات أول - فرع الرياض" = Position
// ─────────────────────────────────────────────────────────────────────────────

export const hrPositionsTable = pgTable(
  "hr_positions",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    jobTitleId: integer("job_title_id")
      .references(() => hrJobTitlesTable.id, { onDelete: "set null" }),
    orgUnitId: integer("org_unit_id")
      .references(() => hrOrgUnitsTable.id, { onDelete: "set null" }),
    jobGradeId: integer("job_grade_id")
      .references(() => hrJobGradesTable.id, { onDelete: "set null" }),
    workLocationId: integer("work_location_id")
      .references(() => hrWorkLocationsTable.id, { onDelete: "set null" }),
    code: text("code"),
    title: text("title").notNull(),
    titleAr: text("title_ar"),
    description: text("description"),
    // vacant | filled | frozen | archived
    status: text("status").notNull().default("vacant"),
    headcount: integer("headcount").notNull().default(1),
    currentOccupancy: integer("current_occupancy").notNull().default(0),
    displayOrder: integer("display_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_hr_positions_workspace").on(t.workspaceId),
    index("idx_hr_positions_org_unit").on(t.orgUnitId),
    index("idx_hr_positions_status").on(t.status),
    index("idx_hr_positions_job_title").on(t.jobTitleId),
    uniqueIndex("uq_hr_positions_ws_code").on(t.workspaceId, t.code),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOM FIELD DEFINITIONS  (metadata-driven)
// Admins define fields per workspace.  No code change needed to add new fields.
// ─────────────────────────────────────────────────────────────────────────────

export const hrCustomFieldDefsTable = pgTable(
  "hr_custom_field_defs",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),

    // Which section of the employee profile this field appears in
    // personal | employment | org | emergency | custom
    section: text("section").notNull().default("custom"),

    name: text("name").notNull(),               // internal key, e.g. "medical_card"
    label: text("label").notNull(),             // display label EN
    labelAr: text("label_ar"),                 // display label AR

    // text | number | date | dropdown | multi_select | boolean | attachment | linked
    fieldType: text("field_type").notNull().default("text"),

    // For dropdown / multi_select: [{ value, label, labelAr }]
    options: jsonb("options"),

    // For linked fields: { entity: "employee" | "org_unit" | "job_title", multiple: bool }
    linkedConfig: jsonb("linked_config"),

    required: boolean("required").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    displayOrder: integer("display_order").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_hr_custom_field_defs_workspace").on(t.workspaceId),
    index("idx_hr_custom_field_defs_section").on(t.section),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// EMPLOYEES  (standalone - no mandatory link to users/accounts)
// userId is optional: set it only when the employee also has a login account.
// ─────────────────────────────────────────────────────────────────────────────

export const employeesTable = pgTable(
  "employees",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),

    // Optional link to a user account (login / Clerk / permissions)
    userId: integer("user_id")
      .unique()
      .references(() => usersTable.id, { onDelete: "set null" }),

    // ── Identity (own fields - not pulled from users table) ──────────────────
    employeeNumber: text("employee_number"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    fullName: text("full_name").notNull(),
    email: text("email"),
    phoneNumber: text("phone_number"),
    avatarUrl: text("avatar_url"),

    // active | on_leave | suspended | terminated | resigned
    status: text("status").notNull().default("active"),

    // ── Personal Information ─────────────────────────────────────────────────
    nationality: text("nationality"),
    gender: text("gender"),           // male | female | other | prefer_not_to_say
    dateOfBirth: date("date_of_birth"),
    maritalStatus: text("marital_status"), // single | married | divorced | widowed
    address: text("address"),
    nationalId: text("national_id"),
    passportNumber: text("passport_number"),

    // ── Employment Information ───────────────────────────────────────────────
    // full_time | part_time | contractor | intern | temporary
    employmentType: text("employment_type").notNull().default("full_time"),
    hireDate: date("hire_date"),
    endDate: date("end_date"),
    probationEndDate: date("probation_end_date"),

    // ── Organizational Position ──────────────────────────────────────────────
    orgUnitId: integer("org_unit_id")
      .references(() => hrOrgUnitsTable.id, { onDelete: "set null" }),
    jobTitleId: integer("job_title_id")
      .references(() => hrJobTitlesTable.id, { onDelete: "set null" }),
    jobGradeId: integer("job_grade_id")
      .references(() => hrJobGradesTable.id, { onDelete: "set null" }),
    positionId: integer("position_id")
      .references(() => hrPositionsTable.id, { onDelete: "set null" }),
    workLocationId: integer("work_location_id")
      .references(() => hrWorkLocationsTable.id, { onDelete: "set null" }),
    position: text("position"),               // free-text fallback if no positionId
    directManagerId: integer("direct_manager_id"), // FK to employees.id (self-ref)
    company: text("company"),
    branch: text("branch"),
    location: text("location"),

    // ── Emergency Contact ────────────────────────────────────────────────────
    emergencyContactName: text("emergency_contact_name"),
    emergencyContactPhone: text("emergency_contact_phone"),
    emergencyContactRelation: text("emergency_contact_relation"),

    // ── Metadata & Dynamic Data ──────────────────────────────────────────────
    leaveBalances: jsonb("leave_balances"),
    onboardingData: jsonb("onboarding_data"),

    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_employees_workspace").on(t.workspaceId),
    index("idx_employees_user").on(t.userId),
    index("idx_employees_org_unit").on(t.orgUnitId),
    index("idx_employees_status").on(t.status),
    index("idx_employees_manager").on(t.directManagerId),
    uniqueIndex("uq_hr_employees_emp_num_ws").on(t.workspaceId, t.employeeNumber),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOM FIELD VALUES  (one row per employee × field definition)
// ─────────────────────────────────────────────────────────────────────────────

export const hrCustomFieldValuesTable = pgTable(
  "hr_custom_field_values",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),
    fieldDefId: integer("field_def_id")
      .notNull()
      .references(() => hrCustomFieldDefsTable.id, { onDelete: "cascade" }),

    // Stores any type: string, number, boolean, array, or { objectPath, name }
    value: jsonb("value"),

    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("uq_hr_cfv_employee_field").on(t.employeeId, t.fieldDefId),
    index("idx_hr_cfv_employee").on(t.employeeId),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACTS
// ─────────────────────────────────────────────────────────────────────────────

export const hrEmployeeContractsTable = pgTable(
  "hr_employee_contracts",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),

    // permanent | fixed_term | probation | freelance | part_time
    contractType: text("contract_type").notNull().default("permanent"),
    startDate: date("start_date"),
    endDate: date("end_date"),

    // draft | active | expired | terminated
    status: text("status").notNull().default("active"),

    // Salary / compensation (kept as free-text for flexibility)
    salary: text("salary"),
    currency: text("currency").notNull().default("SAR"),

    notes: text("notes"),
    // Array of { name, objectPath, size } for attached PDF files
    attachments: jsonb("attachments"),

    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_hr_contracts_employee").on(t.employeeId),
    index("idx_hr_contracts_workspace").on(t.workspaceId),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// OFFICIAL DOCUMENTS
// ─────────────────────────────────────────────────────────────────────────────

export const hrEmployeeDocumentsTable = pgTable(
  "hr_employee_documents",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),

    // national_id | passport | iqama | driving_license | certificate | other
    documentType: text("document_type").notNull().default("other"),
    name: text("name").notNull(),
    documentNumber: text("document_number"),
    issueDate: date("issue_date"),
    expiryDate: date("expiry_date"),

    // Object storage path for the uploaded file
    objectPath: text("object_path"),
    fileName: text("file_name"),
    fileSize: integer("file_size"),
    mimeType: text("mime_type"),
    checksum: text("checksum"),
    storageKey: text("storage_key"),
    categoryCode: text("category_code"),
    isSigned: boolean("is_signed").notNull().default(false),
    signedAt: timestamp("signed_at", { withTimezone: true }),

    notes: text("notes"),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_hr_docs_employee").on(t.employeeId),
    index("idx_hr_docs_type").on(t.documentType),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// LEAVE RECORDS
// ─────────────────────────────────────────────────────────────────────────────

export const hrEmployeeLeavesTable = pgTable(
  "hr_employee_leaves",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),

    // annual | sick | emergency | maternity | paternity | unpaid | other
    leaveType: text("leave_type").notNull().default("annual"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    daysCount: integer("days_count"),

    // pending | approved | rejected | cancelled
    status: text("status").notNull().default("pending"),
    reason: text("reason"),
    notes: text("notes"),

    approvedBy: integer("approved_by").references(() => usersTable.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_hr_leaves_employee").on(t.employeeId),
    index("idx_hr_leaves_status").on(t.status),
    index("idx_hr_leaves_type").on(t.leaveType),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// POSITION HISTORY  (job movements / transfers)
// ─────────────────────────────────────────────────────────────────────────────

export const hrEmployeePositionHistoryTable = pgTable(
  "hr_employee_position_history",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),

    // promotion | transfer | demotion | lateral | title_change | dept_change | other
    changeType: text("change_type").notNull().default("other"),
    effectiveDate: date("effective_date").notNull(),

    fromTitle: text("from_title"),
    toTitle: text("to_title"),
    fromOrgUnitId: integer("from_org_unit_id"),
    toOrgUnitId: integer("to_org_unit_id"),
    fromGrade: text("from_grade"),
    toGrade: text("to_grade"),
    fromManagerId: integer("from_manager_id"),
    toManagerId: integer("to_manager_id"),

    notes: text("notes"),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_hr_pos_history_employee").on(t.employeeId),
    index("idx_hr_pos_history_date").on(t.effectiveDate),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// NOTES
// ─────────────────────────────────────────────────────────────────────────────

export const hrEmployeeNotesTable = pgTable(
  "hr_employee_notes",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),

    content: text("content").notNull(),
    // general | performance | disciplinary | commendation | confidential
    noteType: text("note_type").notNull().default("general"),
    isConfidential: boolean("is_confidential").notNull().default(false),

    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdByName: text("created_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_hr_notes_employee").on(t.employeeId),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVITY LOG  (audit trail for every change on an employee record)
// ─────────────────────────────────────────────────────────────────────────────

export const hrEmployeeActivityTable = pgTable(
  "hr_employee_activity",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),

    action: text("action").notNull(),         // e.g. "profile_updated", "contract_added"
    description: text("description"),
    changes: jsonb("changes"),                // { before: {}, after: {} }

    performedBy: integer("performed_by").references(() => usersTable.id, { onDelete: "set null" }),
    performedByName: text("performed_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_hr_activity_employee").on(t.employeeId),
    index("idx_hr_activity_created").on(t.createdAt),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// HR SERVICE CATALOG  (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

export const hrServicesTable = pgTable(
  "hr_services",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    description: text("description"),
    descriptionAr: text("description_ar"),
    icon: text("icon").notNull().default("FileText"),
    category: text("category").notNull().default("other"),
    formId: integer("form_id").references(() => formDefinitionsTable.id, { onDelete: "set null" }),
    workflowEvent: text("workflow_event"),
    status: text("status").notNull().default("active"),
    permissions: jsonb("permissions"),
    settings: jsonb("settings"),
    displayOrder: integer("display_order").notNull().default(0),
    createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_hr_services_workspace").on(t.workspaceId),
    index("idx_hr_services_status").on(t.status),
    index("idx_hr_services_category").on(t.category),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// HR SERVICE CATEGORIES  (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

export const hrServiceCategoriesTable = pgTable(
  "hr_service_categories",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    slug: text("slug").notNull(),
    icon: text("icon").notNull().default("Tag"),
    color: text("color").notNull().default("#6366f1"),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_hr_categories_workspace").on(t.workspaceId),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// EMPLOYEE STATUSES  (dynamic - not hardcoded)
// e.g. Draft, Active, On Leave, Suspended, Resigned, Terminated
// ─────────────────────────────────────────────────────────────────────────────

export const hrEmployeeStatusesTable = pgTable(
  "hr_employee_statuses",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    color: text("color").notNull().default("#6366f1"),
    isDefault: boolean("is_default").notNull().default(false),
    isFinal: boolean("is_final").notNull().default(false),       // terminal: terminated / resigned
    allowSelfService: boolean("allow_self_service").notNull().default(false),
    displayOrder: integer("display_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("uq_hr_emp_status_code").on(t.workspaceId, t.code),
    index("idx_hr_emp_statuses_workspace").on(t.workspaceId),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// EMPLOYMENT TYPES  (dynamic - replaces hardcoded full_time / part_time / etc.)
// ─────────────────────────────────────────────────────────────────────────────

export const hrEmploymentTypesTable = pgTable(
  "hr_employment_types",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    color: text("color").notNull().default("#6366f1"),
    displayOrder: integer("display_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("uq_hr_emp_type_code").on(t.workspaceId, t.code),
    index("idx_hr_emp_types_workspace").on(t.workspaceId),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT TYPES  (dynamic - annual / open-ended / project / training / etc.)
// ─────────────────────────────────────────────────────────────────────────────

export const hrContractTypesTable = pgTable(
  "hr_contract_types",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    color: text("color").notNull().default("#6366f1"),
    displayOrder: integer("display_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("uq_hr_contract_type_code").on(t.workspaceId, t.code),
    index("idx_hr_contract_types_workspace").on(t.workspaceId),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENT TYPES  (dynamic - national_id / passport / certificate / etc.)
// ─────────────────────────────────────────────────────────────────────────────

export const hrDocumentTypesTable = pgTable(
  "hr_document_types",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    code: text("code"),
    hasExpiry: boolean("has_expiry").notNull().default(false),
    isRequired: boolean("is_required").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_hr_doc_types_workspace").on(t.workspaceId),
    uniqueIndex("uq_hr_document_types_ws_code").on(t.workspaceId, t.code),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// LEAVE POLICIES  (annual days, accrual, carry-over per leave type)
// ─────────────────────────────────────────────────────────────────────────────

export const hrLeavePoliciesTable = pgTable(
  "hr_leave_policies",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    code: text("code"),
    // annual | sick | emergency | maternity | paternity | unpaid | other
    leaveType: text("leave_type").notNull().default("annual"),
    annualDays: integer("annual_days").notNull().default(0),
    // monthly | annual | none
    accrualType: text("accrual_type").notNull().default("monthly"),
    carryOver: boolean("carry_over").notNull().default(false),
    maxCarryOverDays: integer("max_carry_over_days"),
    paid: boolean("paid").notNull().default(true),
    requiresApproval: boolean("requires_approval").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_hr_leave_policies_workspace").on(t.workspaceId),
    uniqueIndex("uq_hr_leave_policies_ws_code").on(t.workspaceId, t.code),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// PROBATION POLICIES
// ─────────────────────────────────────────────────────────────────────────────

export const hrProbationPoliciesTable = pgTable(
  "hr_probation_policies",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    durationDays: integer("duration_days").notNull().default(90),
    extendable: boolean("extendable").notNull().default(false),
    maxExtensionDays: integer("max_extension_days"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_hr_probation_policies_workspace").on(t.workspaceId),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// PAYROLL & COMPENSATION ENGINE
// ─────────────────────────────────────────────────────────────────────────────

// Salary component definitions: base | allowance | deduction | bonus | overtime
export const hrSalaryComponentsTable = pgTable(
  "hr_salary_components",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id").notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    // base | allowance | deduction | bonus | overtime
    componentType: text("component_type").notNull().default("allowance"),
    // fixed | percentage_of_basic | percentage_of_gross
    calculationType: text("calculation_type").notNull().default("fixed"),
    defaultValue: text("default_value"),
    isTaxable: boolean("is_taxable").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("uq_hr_sal_comp_code").on(t.workspaceId, t.code),
    index("idx_hr_sal_comp_workspace").on(t.workspaceId),
  ],
);

// Salary structure templates (e.g. "Standard", "Executive", "Sales")
export const hrSalaryStructuresTable = pgTable(
  "hr_salary_structures",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id").notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    description: text("description"),
    currencyCode: text("currency_code").notNull().default("SAR"),
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("uq_hr_sal_struct_code").on(t.workspaceId, t.code),
    index("idx_hr_sal_struct_workspace").on(t.workspaceId),
  ],
);

// Bridge: which components belong to which structure
export const hrSalaryStructureComponentsTable = pgTable(
  "hr_salary_structure_components",
  {
    id: serial("id").primaryKey(),
    structureId: integer("structure_id").notNull()
      .references(() => hrSalaryStructuresTable.id, { onDelete: "cascade" }),
    componentId: integer("component_id").notNull()
      .references(() => hrSalaryComponentsTable.id, { onDelete: "cascade" }),
    amount: text("amount"),
    percentage: text("percentage"),
    displayOrder: integer("display_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [
    uniqueIndex("uq_hr_struct_comp").on(t.structureId, t.componentId),
    index("idx_hr_struct_comp_structure").on(t.structureId),
  ],
);

// Salary bands: grade-linked min/mid/max ranges
export const hrSalaryBandsTable = pgTable(
  "hr_salary_bands",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id").notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    gradeId: integer("grade_id")
      .references(() => hrJobGradesTable.id, { onDelete: "set null" }),
    currencyCode: text("currency_code").notNull().default("SAR"),
    minAmount: text("min_amount").notNull().default("0"),
    midpointAmount: text("midpoint_amount"),
    maxAmount: text("max_amount").notNull().default("0"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_hr_sal_bands_workspace").on(t.workspaceId),
    index("idx_hr_sal_bands_grade").on(t.gradeId),
  ],
);

// Employee's current/historical compensation assignment
export const hrEmployeeCompensationsTable = pgTable(
  "hr_employee_compensations",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id").notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id").notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),
    structureId: integer("structure_id")
      .references(() => hrSalaryStructuresTable.id, { onDelete: "set null" }),
    basicSalary: text("basic_salary").notNull().default("0"),
    currencyCode: text("currency_code").notNull().default("SAR"),
    effectiveDate: date("effective_date").notNull(),
    endDate: date("end_date"),
    // draft | active | superseded
    status: text("status").notNull().default("active"),
    notes: text("notes"),
    approvedBy: integer("approved_by")
      .references(() => usersTable.id, { onDelete: "set null" }),
    createdBy: integer("created_by")
      .references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_hr_emp_comp_employee").on(t.employeeId),
    index("idx_hr_emp_comp_status").on(t.status),
  ],
);

// Per-employee component overrides on top of structure defaults
export const hrEmployeeCompensationItemsTable = pgTable(
  "hr_employee_compensation_items",
  {
    id: serial("id").primaryKey(),
    compensationId: integer("compensation_id").notNull()
      .references(() => hrEmployeeCompensationsTable.id, { onDelete: "cascade" }),
    componentId: integer("component_id").notNull()
      .references(() => hrSalaryComponentsTable.id, { onDelete: "cascade" }),
    amount: text("amount"),
    percentage: text("percentage"),
    notes: text("notes"),
  },
  (t) => [
    uniqueIndex("uq_hr_emp_comp_item").on(t.compensationId, t.componentId),
    index("idx_hr_emp_comp_items_comp").on(t.compensationId),
  ],
);

// Monthly payroll run
export const hrPayrollRunsTable = pgTable(
  "hr_payroll_runs",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id").notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    periodYear: integer("period_year").notNull(),
    periodMonth: integer("period_month").notNull(),
    currencyCode: text("currency_code").notNull().default("SAR"),
    // draft | processing | approved | paid | cancelled
    status: text("status").notNull().default("draft"),
    totalBasic: text("total_basic").notNull().default("0"),
    totalAllowances: text("total_allowances").notNull().default("0"),
    totalDeductions: text("total_deductions").notNull().default("0"),
    totalBonus: text("total_bonus").notNull().default("0"),
    totalOvertime: text("total_overtime").notNull().default("0"),
    totalGross: text("total_gross").notNull().default("0"),
    totalNet: text("total_net").notNull().default("0"),
    employeeCount: integer("employee_count").notNull().default(0),
    notes: text("notes"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    processedBy: integer("processed_by")
      .references(() => usersTable.id, { onDelete: "set null" }),
    approvedBy: integer("approved_by")
      .references(() => usersTable.id, { onDelete: "set null" }),
    createdBy: integer("created_by")
      .references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("uq_hr_payroll_run_period").on(t.workspaceId, t.periodYear, t.periodMonth),
    index("idx_hr_payroll_runs_workspace").on(t.workspaceId),
    index("idx_hr_payroll_runs_status").on(t.status),
  ],
);

// Per-employee payslip for a payroll run
export const hrPayslipsTable = pgTable(
  "hr_payslips",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id").notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    payrollRunId: integer("payroll_run_id").notNull()
      .references(() => hrPayrollRunsTable.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id").notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),
    compensationId: integer("compensation_id")
      .references(() => hrEmployeeCompensationsTable.id, { onDelete: "set null" }),
    basicSalary: text("basic_salary").notNull().default("0"),
    totalAllowances: text("total_allowances").notNull().default("0"),
    totalDeductions: text("total_deductions").notNull().default("0"),
    totalBonus: text("total_bonus").notNull().default("0"),
    totalOvertime: text("total_overtime").notNull().default("0"),
    grossSalary: text("gross_salary").notNull().default("0"),
    netSalary: text("net_salary").notNull().default("0"),
    currencyCode: text("currency_code").notNull().default("SAR"),
    workingDays: integer("working_days"),
    actualDays: integer("actual_days"),
    absentDays: integer("absent_days").notNull().default(0),
    // draft | final
    status: text("status").notNull().default("draft"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("uq_hr_payslip").on(t.payrollRunId, t.employeeId),
    index("idx_hr_payslips_run").on(t.payrollRunId),
    index("idx_hr_payslips_employee").on(t.employeeId),
  ],
);

// Individual component lines on a payslip (snapshot at time of run)
export const hrPayslipLinesTable = pgTable(
  "hr_payslip_lines",
  {
    id: serial("id").primaryKey(),
    payslipId: integer("payslip_id").notNull()
      .references(() => hrPayslipsTable.id, { onDelete: "cascade" }),
    componentId: integer("component_id")
      .references(() => hrSalaryComponentsTable.id, { onDelete: "set null" }),
    componentCode: text("component_code").notNull(),
    componentName: text("component_name").notNull(),
    componentNameAr: text("component_name_ar"),
    componentType: text("component_type").notNull().default("allowance"),
    amount: text("amount").notNull().default("0"),
    quantity: text("quantity").notNull().default("1"),
    notes: text("notes"),
    displayOrder: integer("display_order").notNull().default(0),
  },
  (t) => [
    index("idx_hr_payslip_lines_payslip").on(t.payslipId),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// LEAVE & ATTENDANCE ENGINE
// ─────────────────────────────────────────────────────────────────────────────

// Shift definitions
export const hrShiftsTable = pgTable(
  "hr_shifts",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id").notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    startTime: text("start_time").notNull().default("08:00"),
    endTime: text("end_time").notNull().default("17:00"),
    breakMinutes: integer("break_minutes").notNull().default(60),
    graceMinutes: integer("grace_minutes").notNull().default(15),
    isFlexible: boolean("is_flexible").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("uq_hr_shift_code").on(t.workspaceId, t.code),
    index("idx_hr_shifts_workspace").on(t.workspaceId),
  ],
);

// Work calendar templates
export const hrWorkCalendarsTable = pgTable(
  "hr_work_calendars",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id").notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    // JSON array of day numbers [0=Sun,1=Mon,...,6=Sat]
    workDays: jsonb("work_days").notNull().default([1, 2, 3, 4, 5]),
    timezone: text("timezone").notNull().default("Asia/Riyadh"),
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("uq_hr_cal_code").on(t.workspaceId, t.code),
    index("idx_hr_work_calendars_workspace").on(t.workspaceId),
  ],
);

// Calendar exceptions: holidays, half-days
export const hrCalendarHolidaysTable = pgTable(
  "hr_calendar_holidays",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id").notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    calendarId: integer("calendar_id").notNull()
      .references(() => hrWorkCalendarsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    date: date("date").notNull(),
    // holiday | half_day | special
    type: text("type").notNull().default("holiday"),
  },
  (t) => [
    index("idx_hr_holidays_calendar").on(t.calendarId),
    index("idx_hr_holidays_date").on(t.date),
  ],
);

// Daily attendance records
export const hrAttendanceTable = pgTable(
  "hr_attendance",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id").notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id").notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    shiftId: integer("shift_id")
      .references(() => hrShiftsTable.id, { onDelete: "set null" }),
    checkIn: text("check_in"),
    checkOut: text("check_out"),
    // present | absent | late | half_day | on_leave | holiday | remote
    status: text("status").notNull().default("present"),
    // manual | biometric | mobile | system
    sourceType: text("source_type").notNull().default("manual"),
    lateMinutes: integer("late_minutes").notNull().default(0),
    earlyLeaveMinutes: integer("early_leave_minutes").notNull().default(0),
    overtimeMinutes: integer("overtime_minutes").notNull().default(0),
    notes: text("notes"),
    approvedBy: integer("approved_by")
      .references(() => usersTable.id, { onDelete: "set null" }),
    createdBy: integer("created_by")
      .references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("uq_hr_attendance_emp_date").on(t.employeeId, t.date),
    index("idx_hr_attendance_workspace").on(t.workspaceId),
    index("idx_hr_attendance_date").on(t.date),
    index("idx_hr_attendance_status").on(t.status),
  ],
);

// Leave balance per employee per policy per year
export const hrLeaveBalancesTable = pgTable(
  "hr_leave_balances",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id").notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id").notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),
    leavePolicyId: integer("leave_policy_id")
      .references(() => hrLeavePoliciesTable.id, { onDelete: "set null" }),
    leaveType: text("leave_type").notNull().default("annual"),
    year: integer("year").notNull(),
    entitled: text("entitled").notNull().default("0"),
    used: text("used").notNull().default("0"),
    pending: text("pending").notNull().default("0"),
    carriedForward: text("carried_forward").notNull().default("0"),
    manualAdjustment: text("manual_adjustment").notNull().default("0"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("uq_hr_leave_balance").on(t.employeeId, t.leavePolicyId, t.year),
    index("idx_hr_leave_balances_employee").on(t.employeeId),
    index("idx_hr_leave_balances_year").on(t.year),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// OVERTIME MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

// Overtime policies: define rates and rules per day-type
export const hrOvertimePoliciesTable = pgTable(
  "hr_overtime_policies",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id").notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    // weekday | weekend | holiday | any
    dayType: text("day_type").notNull().default("any"),
    // multiplier | fixed_rate | custom
    calculationType: text("calculation_type").notNull().default("multiplier"),
    // e.g. "1.5" for 150% of hourly rate
    rateMultiplier: text("rate_multiplier").notNull().default("1.5"),
    // flat rate per overtime hour (overrides multiplier when set)
    fixedRatePerHour: text("fixed_rate_per_hour"),
    // max overtime hours per day / month
    maxHoursPerDay: text("max_hours_per_day"),
    maxHoursPerMonth: text("max_hours_per_month"),
    // minimum OT minutes before policy kicks in (e.g. 30 min threshold)
    minThresholdMinutes: integer("min_threshold_minutes").notNull().default(30),
    requiresApproval: boolean("requires_approval").notNull().default(true),
    autoCalculate: boolean("auto_calculate").notNull().default(true),
    // optional link to a salary component for payroll integration
    salaryComponentId: integer("salary_component_id")
      .references(() => hrSalaryComponentsTable.id, { onDelete: "set null" }),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_hr_ot_policies_workspace").on(t.workspaceId),
    index("idx_hr_ot_policies_active").on(t.isActive),
  ],
);

// Individual overtime records (one per employee per occurrence)
export const hrOvertimeRecordsTable = pgTable(
  "hr_overtime_records",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id").notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id").notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),
    // linked attendance row (nullable for manual entries)
    attendanceId: integer("attendance_id")
      .references(() => hrAttendanceTable.id, { onDelete: "set null" }),
    policyId: integer("policy_id")
      .references(() => hrOvertimePoliciesTable.id, { onDelete: "set null" }),
    shiftId: integer("shift_id")
      .references(() => hrShiftsTable.id, { onDelete: "set null" }),
    date: date("date").notNull(),
    startTime: text("start_time"),
    endTime: text("end_time"),
    durationMinutes: integer("duration_minutes").notNull().default(0),
    // calculated compensation amount
    calculatedAmount: text("calculated_amount"),
    // draft | pending | approved | rejected | paid
    status: text("status").notNull().default("draft"),
    approvedBy: integer("approved_by")
      .references(() => usersTable.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    // payroll linkage once processed
    payrollRunId: integer("payroll_run_id")
      .references(() => hrPayrollRunsTable.id, { onDelete: "set null" }),
    payslipId: integer("payslip_id")
      .references(() => hrPayslipsTable.id, { onDelete: "set null" }),
    notes: text("notes"),
    createdBy: integer("created_by")
      .references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_hr_ot_records_workspace").on(t.workspaceId),
    index("idx_hr_ot_records_employee").on(t.employeeId),
    index("idx_hr_ot_records_date").on(t.date),
    index("idx_hr_ot_records_status").on(t.status),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// WORKSPACE COUNTERS  (atomic per-workspace auto-increment for employee numbers)
// ─────────────────────────────────────────────────────────────────────────────

export const hrWorkspaceCountersTable = pgTable(
  "hr_workspace_counters",
  {
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    counterName: text("counter_name").notNull(),
    currentValue: integer("current_value").notNull().default(1000),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.counterName], name: "pk_hr_workspace_counters" }),
  ],
);

// HR WORKSPACE SETTINGS (numbering engine config + future extensibility)
// ─────────────────────────────────────────────────────────────────────────────

export const hrWorkspaceSettingsTable = pgTable("hr_workspace_settings", {
  workspaceId: integer("workspace_id")
    .primaryKey()
    .references(() => workspacesTable.id, { onDelete: "cascade" }),
  // auto | manual | hybrid
  numberingMode: text("numbering_mode").notNull().default("auto"),
  // optional numeric prefix offset for new workspaces migrating from legacy systems
  numberingStartFrom: integer("numbering_start_from"),
  /** legacy | transition | canonical — workspace leave cutover (P-HCM2) */
  leaveRuntimeMode: text("leave_runtime_mode").notNull().default("transition"),
  /** legacy | shadow | active — workforce canonical cutover (Phase 1) */
  workforceCanonicalMode: text("workforce_canonical_mode").notNull().default("legacy"),
  /** none | employee_to_user | bidirectional */
  workforceSyncDirection: text("workforce_sync_direction").notNull().default("none"),
  /** legacy | shadow | active — org linking enforcement (Phase 2) */
  orgRuntimeMode: text("org_runtime_mode").notNull().default("legacy"),
  /** legacy | dual | unified — approval runtime cutover (Phase 3) */
  approvalRuntimeMode: text("approval_runtime_mode").notNull().default("legacy"),
  /** legacy | shadow | active — workforce governance enforcement (Phase 4) */
  workforceGovernanceMode: text("workforce_governance_mode").notNull().default("legacy"),
  /** Activation gate policy JSON (Phase 4) */
  workforceActivationRequires: jsonb("workforce_activation_requires"),
  /** none | stage1 | stage2 | stage3 | stage4 — gradual cleanup (Phase 5, no drops) */
  workforceCleanupStage: text("workforce_cleanup_stage").notNull().default("none"),
  /** Optional per-surface legacy write policy during cleanup */
  legacyWritePolicy: jsonb("legacy_write_policy"),
  /** warn | shadow | strict — import validation enforcement depth (Phase 0+1) */
  importValidationMode: text("import_validation_mode").notNull().default("warn"),
  /** legacy | shadow | active — employee import pipeline cutover (Phase 0+1) */
  employeeImportRuntimeMode: text("employee_import_runtime_mode").notNull().default("legacy"),
  /** legacy | shadow | active — master data catalog/import cutover (Phase 0+1) */
  masterDataRuntimeMode: text("master_data_runtime_mode").notNull().default("legacy"),
  /** H1 — match-only employee import (no Foundation auto-create) */
  employeeImportMatchOnly: boolean("employee_import_match_only").notNull().default(true),
  /** H6 — route unmatched rows to staging archive */
  employeeImportStagingEnabled: boolean("employee_import_staging_enabled").notNull().default(true),
  /** H5 — block employee import until Foundation minimum is complete */
  foundationReadinessGateEnabled: boolean("foundation_readiness_gate_enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// ─────────────────────────────────────────────────────────────────────────────
// LEAVE DOMAIN - Phase 1
// Purpose: canonical leave request lifecycle.
// Replaces the ad-hoc hr_employee_leaves path for structured leave management.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * leave_requests - Central table for the leave domain lifecycle.
 *
 * Status machine:
 *   pending          → pending_approval → approved / rejected
 *   pending          → withdrawn  (employee self-withdrawal)
 *   pending_approval → withdrawn  (before any approval decision)
 *   approved         → cancelled  (by HR/admin, before start date)
 *
 * Balance invariants (maintained synchronously in the route handler):
 *   On INSERT (requiresApproval=true):   pending += daysRequested
 *   On INSERT (requiresApproval=false):  used    += daysRequested  (auto-approved)
 *   On approved:  pending -= daysRequested, used += daysRequested
 *   On rejected | withdrawn | cancelled: pending -= daysRequested (if was pending)
 */
export const leaveRequestsTable = pgTable(
  "leave_requests",
  {
    id: serial("id").primaryKey(),

    workspaceId: integer("workspace_id").notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),

    employeeId: integer("employee_id").notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),

    requestedByUserId: integer("requested_by_user_id").notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),

    leavePolicyId: integer("leave_policy_id")
      .references(() => hrLeavePoliciesTable.id, { onDelete: "set null" }),

    // annual | sick | unpaid | maternity | emergency | other
    leaveType: text("leave_type").notNull(),

    startDate: date("start_date").notNull(),
    endDate:   date("end_date").notNull(),

    /** Calendar days from startDate to endDate (inclusive). */
    daysRequested: integer("days_requested").notNull(),

    /**
     * Business days calculated from the workspace work calendar.
     * Excludes weekends and holidays from hrCalendarHolidaysTable.
     * Computed server-side - never trusted from client.
     */
    businessDaysCount: integer("business_days_count").notNull(),

    // pending | pending_approval | approved | rejected | withdrawn | cancelled
    status: text("status").notNull().default("pending"),

    employeeNote: text("employee_note"),
    managerNote:  text("manager_note"),

    /** JSON array of file URLs (object storage keys or absolute URLs). */
    attachmentUrls: jsonb("attachment_urls").$type<string[]>(),

    /** The user currently expected to act on the pending approval step. */
    currentApproverId: integer("current_approver_id")
      .references(() => usersTable.id, { onDelete: "set null" }),

    approvedByUserId: integer("approved_by_user_id")
      .references(() => usersTable.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),

    rejectedByUserId: integer("rejected_by_user_id")
      .references(() => usersTable.id, { onDelete: "set null" }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),

    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),

    /** Human-readable unique number per workspace, e.g. "LRQ-202606-1234". */
    requestNumber: text("request_number").notNull(),

    /** FK to form_definitions.id - set when request originated from a form submission. */
    sourceFormId: integer("source_form_id"),

    /** FK to form_submissions.id - set when request originated from a form submission. */
    sourceSubmissionId: integer("source_submission_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_leave_requests_workspace").on(t.workspaceId),
    index("idx_leave_requests_employee").on(t.employeeId),
    index("idx_leave_requests_status").on(t.status),
    index("idx_leave_requests_dates").on(t.startDate, t.endDate),
    uniqueIndex("uq_leave_request_number").on(t.workspaceId, t.requestNumber),
  ],
);

/**
 * leave_approval_steps - Individual approval steps for a leave request.
 *
 * Phase 1: single-step only (stepOrder = 1).
 * Architecture: designed for multi-step chains (stepOrder 1..N).
 *   - Steps are created upfront when the request is submitted.
 *   - Each step is processed in order; subsequent steps are only activated
 *     after the previous step is approved.
 *   - The approverRole records the role context at the time of creation
 *     for audit purposes (the actual approver may change roles later).
 *
 * Status values: pending | approved | rejected | skipped
 */
export const leaveApprovalStepsTable = pgTable(
  "leave_approval_steps",
  {
    id: serial("id").primaryKey(),

    leaveRequestId: integer("leave_request_id").notNull()
      .references(() => leaveRequestsTable.id, { onDelete: "cascade" }),

    stepOrder: integer("step_order").notNull(),

    approverUserId: integer("approver_user_id").notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),

    /** Role context at creation time: "manager" | "hr" | "admin". */
    approverRole: text("approver_role").notNull(),

    // pending | approved | rejected | skipped
    status: text("status").notNull().default("pending"),

    comment: text("comment"),

    decidedAt:  timestamp("decided_at",  { withTimezone: true }),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    timeoutAt:  timestamp("timeout_at",  { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_leave_approval_step").on(t.leaveRequestId, t.stepOrder),
    index("idx_leave_approval_steps_request").on(t.leaveRequestId),
    index("idx_leave_approval_steps_approver").on(t.approverUserId),
    index("idx_leave_approval_steps_status").on(t.status),
  ],
);

/** P-HCM3 — idempotent map: legacy hr_employee_leaves → leave_requests */
export const hrLeaveMigrationMapTable = pgTable(
  "hr_leave_migration_map",
  {
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    legacyLeaveId: integer("legacy_leave_id").notNull(),
    canonicalRequestId: integer("canonical_request_id")
      .notNull()
      .references(() => leaveRequestsTable.id, { onDelete: "cascade" }),
    migratedAt: timestamp("migrated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.legacyLeaveId], name: "pk_hr_leave_migration_map" }),
    index("idx_hr_leave_migration_canonical").on(t.canonicalRequestId),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// WORKFORCE CANONICAL FOUNDATION (Phase 1)
// Maps legacy departments → hr_org_units during cutover.
// ─────────────────────────────────────────────────────────────────────────────

export const legacyDepartmentOrgMapTable = pgTable(
  "legacy_department_org_map",
  {
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    departmentId: integer("department_id")
      .notNull()
      .references(() => departmentsTable.id, { onDelete: "cascade" }),
    orgUnitId: integer("org_unit_id")
      .notNull()
      .references(() => hrOrgUnitsTable.id, { onDelete: "cascade" }),
    matchMethod: text("match_method").notNull().default("name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.departmentId], name: "pk_legacy_department_org_map" }),
    index("idx_legacy_dept_org_map_org_unit").on(t.orgUnitId),
  ],
);

export const workforceMigrationExceptionsTable = pgTable(
  "workforce_migration_exceptions",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    reason: text("reason").notNull(),
    details: jsonb("details"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_workforce_migration_exceptions_ws").on(t.workspaceId),
  ],
);

export const workforceExecutiveOverridesTable = pgTable("workforce_executive_overrides", {
  workspaceId: integer("workspace_id")
    .primaryKey()
    .references(() => workspacesTable.id, { onDelete: "cascade" }),
  ceoEmployeeId: integer("ceo_employee_id"),
  hrDirectorEmployeeId: integer("hr_director_employee_id"),
  maxReportingDepth: integer("max_reporting_depth").notNull().default(10),
  executiveExemptEmployeeIds: jsonb("executive_exempt_employee_ids").notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

/** Phase 2 foundation — consumed by Phase 3 approval/delegation runtime. */
export const workforceDelegationsTable = pgTable(
  "workforce_delegations",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    delegatorEmployeeId: integer("delegator_employee_id").notNull(),
    delegateEmployeeId: integer("delegate_employee_id").notNull(),
    scope: text("scope").notNull().default("all_approvals"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_workforce_delegations_workspace").on(t.workspaceId),
    index("idx_workforce_delegations_delegator").on(t.delegatorEmployeeId),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// PROVISION AUDIT (F4.3 — idempotency + compliance trail)
// ─────────────────────────────────────────────────────────────────────────────

export const hrProvisionAuditLogTable = pgTable(
  "hr_provision_audit_log",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key"),
    operation: text("operation").notNull(),
    employeeId: integer("employee_id").references(() => employeesTable.id, { onDelete: "set null" }),
    userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
    actorUserId: integer("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    outcome: text("outcome").notNull(),
    httpStatus: integer("http_status").notNull(),
    errorMessage: text("error_message"),
    requestFingerprint: text("request_fingerprint").notNull(),
    responseSnapshot: jsonb("response_snapshot"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_hr_provision_audit_ws_idem").on(t.workspaceId, t.idempotencyKey),
    index("idx_hr_provision_audit_workspace").on(t.workspaceId, t.createdAt),
    index("idx_hr_provision_audit_employee").on(t.employeeId, t.createdAt),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type HrProvisionAuditLog         = typeof hrProvisionAuditLogTable.$inferSelect;
export type HrWorkspaceSettings         = typeof hrWorkspaceSettingsTable.$inferSelect;
export type LegacyDepartmentOrgMap      = typeof legacyDepartmentOrgMapTable.$inferSelect;
export type WorkforceMigrationException   = typeof workforceMigrationExceptionsTable.$inferSelect;
export type WorkforceExecutiveOverride    = typeof workforceExecutiveOverridesTable.$inferSelect;
export type WorkforceDelegation           = typeof workforceDelegationsTable.$inferSelect;
export type HrLeaveMigrationMap          = typeof hrLeaveMigrationMapTable.$inferSelect;
export type Employee                    = typeof employeesTable.$inferSelect;
export type HrOrgUnit                   = typeof hrOrgUnitsTable.$inferSelect;
export type HrJobTitle                  = typeof hrJobTitlesTable.$inferSelect;
export type HrJobGrade                  = typeof hrJobGradesTable.$inferSelect;
export type HrPosition                  = typeof hrPositionsTable.$inferSelect;
export type HrWorkLocation              = typeof hrWorkLocationsTable.$inferSelect;
export type HrEmployeeStatus            = typeof hrEmployeeStatusesTable.$inferSelect;
export type HrEmploymentType            = typeof hrEmploymentTypesTable.$inferSelect;
export type HrContractType              = typeof hrContractTypesTable.$inferSelect;
export type HrDocumentType              = typeof hrDocumentTypesTable.$inferSelect;
export type HrLeavePolicy               = typeof hrLeavePoliciesTable.$inferSelect;
export type HrProbationPolicy           = typeof hrProbationPoliciesTable.$inferSelect;
export type HrCustomFieldDef            = typeof hrCustomFieldDefsTable.$inferSelect;
export type HrCustomFieldValue          = typeof hrCustomFieldValuesTable.$inferSelect;
export type HrEmployeeContract          = typeof hrEmployeeContractsTable.$inferSelect;
export type HrEmployeeDocument          = typeof hrEmployeeDocumentsTable.$inferSelect;
export type HrEmployeeLeave             = typeof hrEmployeeLeavesTable.$inferSelect;
export type HrEmployeePositionHistory   = typeof hrEmployeePositionHistoryTable.$inferSelect;
export type HrEmployeeNote              = typeof hrEmployeeNotesTable.$inferSelect;
export type HrEmployeeActivity          = typeof hrEmployeeActivityTable.$inferSelect;
export type HrService                   = typeof hrServicesTable.$inferSelect;
export type HrServiceCategory           = typeof hrServiceCategoriesTable.$inferSelect;
export type HrSalaryComponent           = typeof hrSalaryComponentsTable.$inferSelect;
export type HrSalaryStructure           = typeof hrSalaryStructuresTable.$inferSelect;
export type HrSalaryStructureComponent  = typeof hrSalaryStructureComponentsTable.$inferSelect;
export type HrSalaryBand                = typeof hrSalaryBandsTable.$inferSelect;
export type HrEmployeeCompensation      = typeof hrEmployeeCompensationsTable.$inferSelect;
export type HrEmployeeCompensationItem  = typeof hrEmployeeCompensationItemsTable.$inferSelect;
export type HrPayrollRun                = typeof hrPayrollRunsTable.$inferSelect;
export type HrPayslip                   = typeof hrPayslipsTable.$inferSelect;
export type HrPayslipLine               = typeof hrPayslipLinesTable.$inferSelect;
export type HrShift                     = typeof hrShiftsTable.$inferSelect;
export type HrWorkCalendar              = typeof hrWorkCalendarsTable.$inferSelect;
export type HrCalendarHoliday          = typeof hrCalendarHolidaysTable.$inferSelect;
export type HrAttendance                = typeof hrAttendanceTable.$inferSelect;
export type HrLeaveBalance              = typeof hrLeaveBalancesTable.$inferSelect;
export type HrOvertimePolicy            = typeof hrOvertimePoliciesTable.$inferSelect;
export type HrOvertimeRecord            = typeof hrOvertimeRecordsTable.$inferSelect;
export type HrWorkspaceCounter          = typeof hrWorkspaceCountersTable.$inferSelect;
export type LeaveRequest                = typeof leaveRequestsTable.$inferSelect;
export type LeaveApprovalStep           = typeof leaveApprovalStepsTable.$inferSelect;
