/**
 * Dynamic Data Sources for the Form Engine
 *
 * GET /forms/datasources            - catalog of all available platform data sources
 * GET /forms/datasources/:key/data  - live items for a specific source (workspace-scoped)
 *
 * Fully dynamic: queries the live DB so any new user/department/workflow/role
 * created in the system automatically appears in form fields - zero config.
 */

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  departmentsTable,
  groupsTable,
  workflowDefinitionsTable,
  platformModulesTable,
  workspaceCustomRolesTable,
  ticketsTable,
} from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";
import {
  type AuthRequest,
  requireAuth,
} from "../middlewares/requireAuth";

const router: IRouter = Router();

// ── Catalog definition ────────────────────────────────────────────────────────

export interface DataSourceDef {
  key:           string;
  label:         string;
  labelAr:       string;
  description:   string;
  descriptionAr: string;
  category:      "people" | "organization" | "operations" | "automation" | "access" | "platform";
  icon:          string;
  fieldType:     string;
  allowMultiple: boolean;
  searchable:    boolean;
}

export const DATA_SOURCE_CATALOG: DataSourceDef[] = [
  // ── People ──────────────────────────────────────────────────────────────────
  {
    key: "users", label: "All Users", labelAr: "جميع المستخدمين",
    description: "All workspace users (any role)",
    descriptionAr: "جميع مستخدمي مساحة العمل (أي دور)",
    category: "people", icon: "Users", fieldType: "dropdown",
    allowMultiple: true, searchable: true,
  },
  {
    key: "managers", label: "Managers", labelAr: "المدراء",
    description: "Users with manager or admin role",
    descriptionAr: "المستخدمون بدور مدير أو أعلى",
    category: "people", icon: "UserCog", fieldType: "dropdown",
    allowMultiple: false, searchable: true,
  },
  {
    key: "admins", label: "Admins", labelAr: "المشرفون",
    description: "Users with admin role",
    descriptionAr: "المستخدمون بدور مشرف",
    category: "people", icon: "ShieldCheck", fieldType: "dropdown",
    allowMultiple: false, searchable: true,
  },
  {
    key: "employees", label: "Employees", labelAr: "الموظفون",
    description: "All workspace members (member role)",
    descriptionAr: "جميع أعضاء مساحة العمل (دور عضو)",
    category: "people", icon: "User", fieldType: "dropdown",
    allowMultiple: true, searchable: true,
  },

  // ── Organization ────────────────────────────────────────────────────────────
  {
    key: "departments", label: "Departments", labelAr: "الأقسام",
    description: "All workspace departments",
    descriptionAr: "جميع أقسام مساحة العمل",
    category: "organization", icon: "Building2", fieldType: "dropdown",
    allowMultiple: false, searchable: true,
  },
  {
    key: "groups", label: "Groups", labelAr: "المجموعات",
    description: "All workspace groups",
    descriptionAr: "جميع مجموعات مساحة العمل",
    category: "organization", icon: "UsersRound", fieldType: "dropdown",
    allowMultiple: true, searchable: true,
  },

  // ── Operations ──────────────────────────────────────────────────────────────
  {
    key: "tickets", label: "Tickets", labelAr: "التذاكر",
    description: "All open/in-progress tickets",
    descriptionAr: "جميع التذاكر المفتوحة",
    category: "operations", icon: "Ticket", fieldType: "dropdown",
    allowMultiple: false, searchable: true,
  },

  // ── Automation ──────────────────────────────────────────────────────────────
  {
    key: "workflows", label: "Workflows", labelAr: "سير العمل",
    description: "All active automation workflows",
    descriptionAr: "جميع سير العمل النشطة",
    category: "automation", icon: "GitFork", fieldType: "dropdown",
    allowMultiple: false, searchable: false,
  },

  // ── Access ──────────────────────────────────────────────────────────────────
  {
    key: "roles", label: "System Roles", labelAr: "الأدوار",
    description: "Built-in platform roles",
    descriptionAr: "الأدوار المدمجة في المنصة",
    category: "access", icon: "Shield", fieldType: "radio",
    allowMultiple: false, searchable: false,
  },
  {
    key: "custom_roles", label: "Custom Roles", labelAr: "الأدوار المخصصة",
    description: "Workspace-defined custom roles",
    descriptionAr: "الأدوار المخصصة لمساحة العمل",
    category: "access", icon: "ShieldPlus", fieldType: "dropdown",
    allowMultiple: false, searchable: false,
  },

  // ── Platform ────────────────────────────────────────────────────────────────
  {
    key: "modules", label: "Platform Modules", labelAr: "وحدات المنصة",
    description: "All platform modules",
    descriptionAr: "جميع وحدات المنصة",
    category: "platform", icon: "Box", fieldType: "checkbox",
    allowMultiple: true, searchable: false,
  },
];

export interface DataSourceItem {
  value:    string;
  label:    string;
  labelAr?: string | null;
  meta?:    Record<string, unknown>;
}

// ── GET /forms/datasources ────────────────────────────────────────────────────

router.get("/forms/datasources", requireAuth, (_req: AuthRequest, res): void => {
  res.json(DATA_SOURCE_CATALOG);
});

// ── GET /forms/datasources/:key/data ─────────────────────────────────────────

router.get("/forms/datasources/:key/data", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  const key = String(req.params["key"]);
  const wid = req.workspaceId;
  let items: DataSourceItem[] = [];

  switch (key) {
    // ── People ────────────────────────────────────────────────────────────────
    case "users": {
      const rows = await db
        .select({ id: usersTable.id, fullName: usersTable.fullName, role: usersTable.role })
        .from(usersTable)
        .where(eq(usersTable.workspaceId, wid))
        .orderBy(asc(usersTable.fullName));
      items = rows.map((r) => ({
        value: String(r.id),
        label: r.fullName ?? "Unknown",
        meta:  { role: r.role },
      }));
      break;
    }

    case "managers": {
      const rows = await db
        .select({ id: usersTable.id, fullName: usersTable.fullName, role: usersTable.role })
        .from(usersTable)
        .where(eq(usersTable.workspaceId, wid))
        .orderBy(asc(usersTable.fullName));
      items = rows
        .filter((r) => r.role === "manager" || r.role === "admin" || r.role === "super_admin")
        .map((r) => ({ value: String(r.id), label: r.fullName ?? "Unknown", meta: { role: r.role } }));
      break;
    }

    case "admins": {
      const rows = await db
        .select({ id: usersTable.id, fullName: usersTable.fullName, role: usersTable.role })
        .from(usersTable)
        .where(eq(usersTable.workspaceId, wid))
        .orderBy(asc(usersTable.fullName));
      items = rows
        .filter((r) => r.role === "admin" || r.role === "super_admin")
        .map((r) => ({ value: String(r.id), label: r.fullName ?? "Unknown" }));
      break;
    }

    case "employees": {
      const rows = await db
        .select({ id: usersTable.id, fullName: usersTable.fullName, role: usersTable.role })
        .from(usersTable)
        .where(eq(usersTable.workspaceId, wid))
        .orderBy(asc(usersTable.fullName));
      items = rows
        .filter((r) => r.role === "member")
        .map((r) => ({ value: String(r.id), label: r.fullName ?? "Unknown" }));
      break;
    }

    // ── Organization ──────────────────────────────────────────────────────────
    case "departments": {
      const rows = await db
        .select({ id: departmentsTable.id, name: departmentsTable.name })
        .from(departmentsTable)
        .where(eq(departmentsTable.workspaceId, wid))
        .orderBy(asc(departmentsTable.name));
      items = rows.map((r) => ({ value: String(r.id), label: r.name }));
      break;
    }

    case "groups": {
      const rows = await db
        .select({ id: groupsTable.id, name: groupsTable.name })
        .from(groupsTable)
        .where(eq(groupsTable.workspaceId, wid))
        .orderBy(asc(groupsTable.name));
      items = rows.map((r) => ({ value: String(r.id), label: r.name }));
      break;
    }

    // ── Operations ────────────────────────────────────────────────────────────
    case "tickets": {
      const rows = await db
        .select({ id: ticketsTable.id, title: ticketsTable.title, status: ticketsTable.status })
        .from(ticketsTable)
        .where(eq(ticketsTable.workspaceId, wid))
        .orderBy(asc(ticketsTable.id));
      items = rows
        .filter((r) => r.status !== "closed" && r.status !== "resolved")
        .map((r) => ({
          value: String(r.id),
          label: `#${r.id} - ${r.title ?? "Untitled"}`,
          meta:  { status: r.status },
        }));
      break;
    }

    // ── Automation ────────────────────────────────────────────────────────────
    case "workflows": {
      const rows = await db
        .select({ id: workflowDefinitionsTable.id, name: workflowDefinitionsTable.name, key: workflowDefinitionsTable.key })
        .from(workflowDefinitionsTable)
        .where(and(
          eq(workflowDefinitionsTable.workspaceId, wid),
          eq(workflowDefinitionsTable.isActive, true),
        ))
        .orderBy(asc(workflowDefinitionsTable.name));
      items = rows.map((r) => ({ value: String(r.id), label: r.name, meta: { key: r.key } }));
      break;
    }

    // ── Access ────────────────────────────────────────────────────────────────
    case "roles": {
      items = [
        { value: "admin",   label: "Admin",   labelAr: "مشرف" },
        { value: "manager", label: "Manager", labelAr: "مدير" },
        { value: "member",  label: "Member",  labelAr: "عضو" },
      ];
      break;
    }

    case "custom_roles": {
      const rows = await db
        .select({ id: workspaceCustomRolesTable.id, name: workspaceCustomRolesTable.name })
        .from(workspaceCustomRolesTable)
        .where(eq(workspaceCustomRolesTable.workspaceId, wid))
        .orderBy(asc(workspaceCustomRolesTable.name));
      items = rows.map((r) => ({ value: String(r.id), label: r.name }));
      break;
    }

    // ── Platform ──────────────────────────────────────────────────────────────
    case "modules": {
      const rows = await db
        .select({ key: platformModulesTable.key, name: platformModulesTable.name, nameAr: platformModulesTable.nameAr })
        .from(platformModulesTable)
        .orderBy(asc(platformModulesTable.displayOrder));
      items = rows.map((r) => ({ value: r.key, label: r.name, labelAr: r.nameAr }));
      break;
    }

    default:
      res.status(404).json({ error: `Unknown data source: ${key}` });
      return;
  }

  res.json(items);
});

export default router;
