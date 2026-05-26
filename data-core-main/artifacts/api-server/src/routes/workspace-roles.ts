import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  workspaceCustomRolesTable,
  workspaceRolePermissionsTable,
  usersTable,
  formDefinitionsTable,
  hrServicesTable,
  departmentsTable,
  groupsTable,
  workflowDefinitionsTable,
} from "@workspace/db";
import { eq, and, sql, ne } from "drizzle-orm";
import {
  CreateWorkspaceRoleBody,
  GetWorkspaceRoleParams,
  UpdateWorkspaceRoleBody,
  UpdateWorkspaceRoleParams,
  DeleteWorkspaceRoleParams,
  SetRolePermissionsBody,
  SetRolePermissionsParams,
} from "@workspace/api-zod";
import { type AuthRequest, requireAuth, requireWorkspaceAdmin } from "../middlewares/requireAuth";

const router: IRouter = Router();

// ── Static base permission groups (always present) ─────────────────────────

const STATIC_PERMISSION_GROUPS = [
  {
    module: "users",
    label: "User Management",
    labelAr: "إدارة المستخدمين",
    icon: "Users",
    permissions: [
      { key: "users.view",           label: "View employees",          labelAr: "عرض الموظفين" },
      { key: "users.create",         label: "Add employees",           labelAr: "إضافة موظفين" },
      { key: "users.edit",           label: "Edit employee profiles",  labelAr: "تعديل ملفات الموظفين" },
      { key: "users.delete",         label: "Deactivate employees",    labelAr: "إيقاف الموظفين" },
      { key: "users.reset_password", label: "Reset passwords",         labelAr: "إعادة تعيين كلمات المرور" },
    ],
  },
  {
    module: "departments",
    label: "Departments",
    labelAr: "الأقسام",
    icon: "Building2",
    permissions: [
      { key: "departments.view",   label: "View all departments",   labelAr: "عرض جميع الأقسام" },
      { key: "departments.create", label: "Create departments",     labelAr: "إنشاء أقسام" },
      { key: "departments.edit",   label: "Edit departments",       labelAr: "تعديل الأقسام" },
      { key: "departments.delete", label: "Delete departments",     labelAr: "حذف الأقسام" },
    ],
  },
  {
    module: "tickets",
    label: "Tickets",
    labelAr: "التذاكر",
    icon: "Ticket",
    permissions: [
      { key: "tickets.view",   label: "View tickets",   labelAr: "عرض التذاكر" },
      { key: "tickets.create", label: "Create tickets", labelAr: "إنشاء تذاكر" },
      { key: "tickets.edit",   label: "Edit tickets",   labelAr: "تعديل التذاكر" },
      { key: "tickets.assign", label: "Assign tickets", labelAr: "تعيين التذاكر" },
      { key: "tickets.close",  label: "Close tickets",  labelAr: "إغلاق التذاكر" },
    ],
  },
  {
    module: "approvals",
    label: "Approvals",
    labelAr: "الموافقات",
    icon: "CheckSquare",
    permissions: [
      { key: "approvals.view",   label: "View approval requests",    labelAr: "عرض طلبات الموافقة" },
      { key: "approvals.manage", label: "Approve or reject requests", labelAr: "قبول أو رفض الطلبات" },
    ],
  },
  {
    module: "leave",
    label: "Leave",
    labelAr: "الإجازات",
    icon: "CalendarDays",
    permissions: [
      { key: "leave.view",   label: "View leave requests",    labelAr: "عرض طلبات الإجازة" },
      { key: "leave.manage", label: "Approve / manage leave", labelAr: "اعتماد وإدارة الإجازات" },
      { key: "leave.submit", label: "Submit own leave",       labelAr: "تقديم إجازة شخصية" },
    ],
  },
  {
    module: "hr",
    label: "Human Resources",
    labelAr: "الموارد البشرية",
    icon: "BriefcaseBusiness",
    permissions: [
      { key: "hr.view",            label: "View HR module",              labelAr: "عرض الموارد البشرية" },
      { key: "hr.manage",          label: "Manage employee profiles",    labelAr: "إدارة ملفات الموظفين" },
      { key: "hr.services.manage", label: "Manage HR services catalog",  labelAr: "إدارة خدمات الموارد البشرية" },
    ],
  },
  {
    module: "payroll",
    label: "Payroll",
    labelAr: "الرواتب",
    icon: "DollarSign",
    permissions: [
      { key: "hr.payroll.view",   label: "View payroll",           labelAr: "عرض الرواتب" },
      { key: "hr.payroll.admin",  label: "Administer payroll runs", labelAr: "إدارة دورات الرواتب" },
      { key: "hr.payroll.export", label: "Export payroll & payslips", labelAr: "تصدير الرواتب والقسائم" },
    ],
  },
  {
    module: "attendance",
    label: "Time & Attendance",
    labelAr: "الحضور والانصراف",
    icon: "Clock",
    permissions: [
      { key: "hr.attendance.view",   label: "View attendance",        labelAr: "عرض الحضور" },
      { key: "hr.attendance.manage", label: "Manage attendance",      labelAr: "إدارة الحضور" },
      { key: "hr.attendance.import", label: "Import attendance data", labelAr: "استيراد الحضور" },
    ],
  },
  {
    module: "self-service",
    label: "Employee Self-Service",
    labelAr: "الخدمات الذاتية",
    icon: "ConciergeBell",
    permissions: [
      { key: "self_service.view", label: "Access self-service portal", labelAr: "الوصول للخدمات الذاتية" },
    ],
  },
  {
    module: "report-center",
    label: "HR Report Center",
    labelAr: "تقارير الموارد البشرية",
    icon: "FileText",
    permissions: [
      { key: "reports.view", label: "View and export HR reports", labelAr: "عرض وتصدير تقارير HR" },
    ],
  },
  {
    module: "messages",
    label: "Messages",
    labelAr: "الرسائل",
    icon: "Mail",
    permissions: [
      { key: "messages.view", label: "View messages", labelAr: "عرض الرسائل" },
      { key: "messages.send", label: "Send messages", labelAr: "إرسال الرسائل" },
    ],
  },
  {
    module: "calendar",
    label: "Calendar",
    labelAr: "التقويم",
    icon: "CalendarDays",
    permissions: [
      { key: "calendar.view",   label: "View calendar",           labelAr: "عرض التقويم" },
      { key: "calendar.manage", label: "Create and manage events", labelAr: "إنشاء وإدارة الأحداث" },
    ],
  },
  {
    module: "notifications",
    label: "Notifications",
    labelAr: "الإشعارات",
    icon: "Bell",
    permissions: [
      { key: "notifications.view", label: "View notifications", labelAr: "عرض الإشعارات" },
    ],
  },
  {
    module: "groups",
    label: "Groups",
    labelAr: "المجموعات",
    icon: "UsersRound",
    permissions: [
      { key: "groups.view",   label: "View all groups",           labelAr: "عرض جميع المجموعات" },
      { key: "groups.manage", label: "Create and manage groups",  labelAr: "إنشاء وإدارة المجموعات" },
    ],
  },
  {
    module: "workflows",
    label: "Workflows",
    labelAr: "سير العمل",
    icon: "GitFork",
    permissions: [
      { key: "workflow.view",   label: "View all workflows",   labelAr: "عرض جميع سير العمل" },
      { key: "workflow.manage", label: "Manage workflows",     labelAr: "إدارة سير العمل" },
    ],
  },
  {
    module: "forms",
    label: "Forms",
    labelAr: "النماذج",
    icon: "ClipboardList",
    permissions: [
      { key: "forms.view",   label: "View all forms", labelAr: "عرض جميع النماذج" },
      { key: "forms.manage", label: "Manage forms",   labelAr: "إدارة النماذج" },
    ],
  },
  {
    module: "dashboard",
    label: "Dashboard",
    labelAr: "لوحة التحكم",
    icon: "LayoutDashboard",
    permissions: [
      { key: "dashboard.view", label: "View dashboard", labelAr: "عرض لوحة التحكم" },
    ],
  },
  {
    module: "roles",
    label: "Roles & Permissions",
    labelAr: "الأدوار والصلاحيات",
    icon: "ShieldCheck",
    permissions: [
      { key: "roles.view",   label: "View roles",                   labelAr: "عرض الأدوار" },
      { key: "roles.manage", label: "Manage roles and permissions",  labelAr: "إدارة الأدوار والصلاحيات" },
    ],
  },
  {
    module: "settings",
    label: "Settings",
    labelAr: "الإعدادات",
    icon: "Settings",
    permissions: [
      { key: "settings.view",   label: "View workspace settings",   labelAr: "عرض إعدادات مساحة العمل" },
      { key: "settings.manage", label: "Manage workspace settings", labelAr: "إدارة إعدادات مساحة العمل" },
    ],
  },
  {
    module: "reports",
    label: "Reports",
    labelAr: "التقارير",
    icon: "BarChart2",
    permissions: [
      { key: "reports.view", label: "View reports and analytics", labelAr: "عرض التقارير والتحليلات" },
    ],
  },
  {
    module: "billing",
    label: "Billing & Invoices",
    labelAr: "الفواتير",
    icon: "FileText",
    permissions: [
      {
        key: "tenant.billing.invoices.read",
        label: "View workspace invoices",
        labelAr: "عرض فواتير مساحة العمل",
      },
      {
        key: "tenant.billing.invoiceDocuments.download",
        label: "Download invoice PDFs",
        labelAr: "تحميل ملفات الفواتير PDF",
      },
    ],
  },
  {
    module: "subscription",
    label: "Subscription Status",
    labelAr: "حالة الاشتراك",
    icon: "CreditCard",
    permissions: [
      {
        key: "tenant.subscription.read",
        label: "View subscription status overview",
        labelAr: "عرض ملخص حالة الاشتراك",
      },
      {
        key: "tenant.subscription.entitlements.read",
        label: "View enabled modules and features",
        labelAr: "عرض الموديولات والميزات المفعلة",
      },
      {
        key: "tenant.subscription.quotas.read",
        label: "View usage limits and consumption",
        labelAr: "عرض حدود الاستخدام والاستهلاك",
      },
    ],
  },
];

// ── Build dynamic permission registry (static + workspace-specific) ─────────

async function buildPermissionRegistry(workspaceId: number) {
  const groups = STATIC_PERMISSION_GROUPS.map(g => ({ ...g, dynamic: false }));

  // ── Dynamic: each active department ──────────────────────────────────────
  const departments = await db
    .select({ id: departmentsTable.id, name: departmentsTable.name })
    .from(departmentsTable)
    .where(eq(departmentsTable.workspaceId, workspaceId))
    .orderBy(departmentsTable.name);

  if (departments.length > 0) {
    groups.push({
      module: "departments_dynamic",
      label: "Department Access (per department)",
      labelAr: "صلاحيات الأقسام (لكل قسم)",
      icon: "Building2",
      dynamic: true,
      permissions: departments.flatMap(d => [
        { key: `departments.${d.id}.view`,   label: `View: ${d.name}`,   labelAr: `عرض: ${d.name}` },
        { key: `departments.${d.id}.manage`, label: `Manage: ${d.name}`, labelAr: `إدارة: ${d.name}` },
      ]),
    });
  }

  // ── Dynamic: each group ───────────────────────────────────────────────────
  const dbGroups = await db
    .select({ id: groupsTable.id, name: groupsTable.name })
    .from(groupsTable)
    .where(eq(groupsTable.workspaceId, workspaceId))
    .orderBy(groupsTable.name);

  if (dbGroups.length > 0) {
    groups.push({
      module: "groups_dynamic",
      label: "Group Access (per group)",
      labelAr: "صلاحيات المجموعات (لكل مجموعة)",
      icon: "UsersRound",
      dynamic: true,
      permissions: dbGroups.flatMap(g => [
        { key: `groups.${g.id}.view`,   label: `View: ${g.name}`,   labelAr: `عرض: ${g.name}` },
        { key: `groups.${g.id}.manage`, label: `Manage: ${g.name}`, labelAr: `إدارة: ${g.name}` },
      ]),
    });
  }

  // ── Dynamic: each workflow definition ────────────────────────────────────
  const workflows = await db
    .select({ id: workflowDefinitionsTable.id, name: workflowDefinitionsTable.name, nameAr: workflowDefinitionsTable.nameAr })
    .from(workflowDefinitionsTable)
    .where(eq(workflowDefinitionsTable.workspaceId, workspaceId))
    .orderBy(workflowDefinitionsTable.name);

  if (workflows.length > 0) {
    groups.push({
      module: "workflows_dynamic",
      label: "Workflow Access (per workflow)",
      labelAr: "صلاحيات سير العمل (لكل سير عمل)",
      icon: "GitFork",
      dynamic: true,
      permissions: workflows.flatMap(w => [
        { key: `workflows.${w.id}.view`,    label: `View: ${w.name}`,    labelAr: w.nameAr ? `عرض: ${w.nameAr}` : `عرض: ${w.name}` },
        { key: `workflows.${w.id}.manage`,  label: `Manage: ${w.name}`,  labelAr: w.nameAr ? `إدارة: ${w.nameAr}` : `إدارة: ${w.name}` },
        { key: `workflows.${w.id}.trigger`, label: `Trigger: ${w.name}`, labelAr: w.nameAr ? `تشغيل: ${w.nameAr}` : `تشغيل: ${w.name}` },
      ]),
    });
  }

  // ── Dynamic: each active form ─────────────────────────────────────────────
  const forms = await db
    .select({ id: formDefinitionsTable.id, name: formDefinitionsTable.name, nameAr: formDefinitionsTable.nameAr })
    .from(formDefinitionsTable)
    .where(and(
      eq(formDefinitionsTable.workspaceId, workspaceId),
      eq(formDefinitionsTable.status, "active"),
    ));

  if (forms.length > 0) {
    groups.push({
      module: "forms_dynamic",
      label: "Form Access (per form)",
      labelAr: "صلاحيات النماذج (لكل نموذج)",
      icon: "ClipboardList",
      dynamic: true,
      permissions: forms.flatMap(f => [
        { key: `forms.${f.id}.view`,   label: `View: ${f.name}`,   labelAr: f.nameAr ? `عرض: ${f.nameAr}` : `عرض: ${f.name}` },
        { key: `forms.${f.id}.submit`, label: `Submit: ${f.name}`, labelAr: f.nameAr ? `تقديم: ${f.nameAr}` : `تقديم: ${f.name}` },
        { key: `forms.${f.id}.manage`, label: `Manage: ${f.name}`, labelAr: f.nameAr ? `إدارة: ${f.nameAr}` : `إدارة: ${f.name}` },
      ]),
    });
  }

  // ── Dynamic: each active HR service ──────────────────────────────────────
  const hrServices = await db
    .select({ id: hrServicesTable.id, name: hrServicesTable.name, nameAr: hrServicesTable.nameAr })
    .from(hrServicesTable)
    .where(and(
      eq(hrServicesTable.workspaceId, workspaceId),
      eq(hrServicesTable.status, "active"),
    ));

  if (hrServices.length > 0) {
    groups.push({
      module: "hr_services_dynamic",
      label: "HR Services Access (per service)",
      labelAr: "صلاحيات خدمات الموارد البشرية (لكل خدمة)",
      icon: "BriefcaseBusiness",
      dynamic: true,
      permissions: hrServices.flatMap(s => [
        { key: `hr.services.${s.id}.request`, label: `Request: ${s.name}`,  labelAr: s.nameAr ? `طلب: ${s.nameAr}` : `طلب: ${s.name}` },
        { key: `hr.services.${s.id}.manage`,  label: `Manage: ${s.name}`,   labelAr: s.nameAr ? `إدارة: ${s.nameAr}` : `إدارة: ${s.name}` },
      ]),
    });
  }

  return groups;
}

// ── Build role response ────────────────────────────────────────────────────

async function buildRole(
  role: { id: number; workspaceId: number; name: string; description: string | null; color: string; createdAt: Date; updatedAt: Date },
  workspaceId: number
) {
  const perms = await db
    .select({ permission: workspaceRolePermissionsTable.permission })
    .from(workspaceRolePermissionsTable)
    .where(eq(workspaceRolePermissionsTable.customRoleId, role.id));

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(usersTable)
    .where(and(
      eq(usersTable.workspaceId, workspaceId),
      eq(usersTable.customRoleId, role.id),
    ));

  return { ...role, permissions: perms.map(p => p.permission), userCount: count };
}

// ── Routes ─────────────────────────────────────────────────────────────────

router.get("/workspace-roles", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.json([]); return; }

  const roles = await db
    .select()
    .from(workspaceCustomRolesTable)
    .where(eq(workspaceCustomRolesTable.workspaceId, req.workspaceId))
    .orderBy(workspaceCustomRolesTable.name);

  const result = await Promise.all(roles.map(role => buildRole(role, req.workspaceId!)));
  res.json(result);
});

router.post("/workspace-roles", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(400).json({ error: "No workspace" }); return; }

  const parsed = CreateWorkspaceRoleBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [role] = await db.insert(workspaceCustomRolesTable).values({
    workspaceId: req.workspaceId,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    color: parsed.data.color ?? "#6366f1",
  }).returning();

  res.status(201).json({ ...role, permissions: [], userCount: 0 });
});

router.get("/workspace-roles/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const params = GetWorkspaceRoleParams.safeParse({ id: req.params.id });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [role] = await db
    .select()
    .from(workspaceCustomRolesTable)
    .where(and(
      eq(workspaceCustomRolesTable.id, params.data.id),
      req.workspaceId ? eq(workspaceCustomRolesTable.workspaceId, req.workspaceId) : undefined!,
    ));

  if (!role) { res.status(404).json({ error: "Role not found" }); return; }

  res.json(await buildRole(role, req.workspaceId ?? 0));
});

router.patch("/workspace-roles/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const params = UpdateWorkspaceRoleParams.safeParse({ id: req.params.id });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const parsed = UpdateWorkspaceRoleBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [role] = await db
    .update(workspaceCustomRolesTable)
    .set(parsed.data)
    .where(and(
      eq(workspaceCustomRolesTable.id, params.data.id),
      req.workspaceId ? eq(workspaceCustomRolesTable.workspaceId, req.workspaceId) : undefined!,
    ))
    .returning();

  if (!role) { res.status(404).json({ error: "Role not found" }); return; }

  res.json(await buildRole(role, req.workspaceId ?? 0));
});

router.delete("/workspace-roles/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const params = DeleteWorkspaceRoleParams.safeParse({ id: req.params.id });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [role] = await db
    .delete(workspaceCustomRolesTable)
    .where(and(
      eq(workspaceCustomRolesTable.id, params.data.id),
      req.workspaceId ? eq(workspaceCustomRolesTable.workspaceId, req.workspaceId) : undefined!,
    ))
    .returning();

  if (!role) { res.status(404).json({ error: "Role not found" }); return; }

  res.sendStatus(204);
});

router.put("/workspace-roles/:id/permissions", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const params = SetRolePermissionsParams.safeParse({ id: req.params.id });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const parsed = SetRolePermissionsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [role] = await db
    .select()
    .from(workspaceCustomRolesTable)
    .where(and(
      eq(workspaceCustomRolesTable.id, params.data.id),
      req.workspaceId ? eq(workspaceCustomRolesTable.workspaceId, req.workspaceId) : undefined!,
    ));

  if (!role) { res.status(404).json({ error: "Role not found" }); return; }

  await db.delete(workspaceRolePermissionsTable)
    .where(eq(workspaceRolePermissionsTable.customRoleId, params.data.id));

  if (parsed.data.permissions.length > 0) {
    await db.insert(workspaceRolePermissionsTable).values(
      parsed.data.permissions.map(p => ({ customRoleId: params.data.id, permission: p }))
    );
  }

  res.json(await buildRole(role, req.workspaceId ?? 0));
});

// ── Role members (user assignment) ─────────────────────────────────────────

router.get("/workspace-roles/:id/members", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.json([]); return; }

  const roleId = Number(req.params.id);
  if (!roleId) { res.status(400).json({ error: "Invalid role ID" }); return; }

  const members = await db
    .select({
      id: usersTable.id,
      fullName: usersTable.fullName,
      email: usersTable.email,
      avatarUrl: usersTable.avatarUrl,
      position: usersTable.position,
      role: usersTable.role,
      status: usersTable.status,
    })
    .from(usersTable)
    .where(and(
      eq(usersTable.workspaceId, req.workspaceId),
      eq(usersTable.customRoleId, roleId),
    ));

  res.json(members);
});

router.post("/workspace-roles/:id/members", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(400).json({ error: "No workspace" }); return; }

  const roleId = Number(req.params.id);
  if (!roleId) { res.status(400).json({ error: "Invalid role ID" }); return; }

  const { userIds } = req.body as { userIds: number[] };
  if (!Array.isArray(userIds) || userIds.length === 0) {
    res.status(400).json({ error: "userIds must be a non-empty array" });
    return;
  }

  const [role] = await db
    .select({ id: workspaceCustomRolesTable.id })
    .from(workspaceCustomRolesTable)
    .where(and(
      eq(workspaceCustomRolesTable.id, roleId),
      eq(workspaceCustomRolesTable.workspaceId, req.workspaceId),
    ));

  if (!role) { res.status(404).json({ error: "Role not found" }); return; }

  for (const userId of userIds) {
    await db
      .update(usersTable)
      .set({ customRoleId: roleId })
      .where(and(
        eq(usersTable.id, userId),
        eq(usersTable.workspaceId, req.workspaceId),
      ));
  }

  res.json({ assigned: userIds.length });
});

router.delete("/workspace-roles/:id/members/:userId", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(400).json({ error: "No workspace" }); return; }

  const roleId = Number(req.params.id);
  const userId = Number(req.params.userId);

  if (!roleId || !userId) { res.status(400).json({ error: "Invalid ID" }); return; }

  await db
    .update(usersTable)
    .set({ customRoleId: null })
    .where(and(
      eq(usersTable.id, userId),
      eq(usersTable.workspaceId, req.workspaceId),
      eq(usersTable.customRoleId, roleId),
    ));

  res.sendStatus(204);
});

// ── Permission registry (dynamic) ──────────────────────────────────────────

router.get("/permissions", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) {
    res.json({ groups: STATIC_PERMISSION_GROUPS });
    return;
  }
  const groups = await buildPermissionRegistry(req.workspaceId);
  res.json({ groups });
});

export default router;
