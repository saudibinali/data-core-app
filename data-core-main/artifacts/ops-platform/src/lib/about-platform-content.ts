/**
 * Factual capability copy for the public About Platform page.
 * Derived from seeded modules, routes, platform permissions, and product docs.
 */

export const WORKSPACE_MODULES = [
  { name: "Home", desc: "Personal workspace home with quick actions (core, always available)." },
  { name: "Dashboard", desc: "Activity overview and workspace statistics." },
  { name: "Messages", desc: "Internal messaging threads, replies, and unread tracking." },
  { name: "Calendar", desc: "Team events and RSVP." },
  { name: "Tickets", desc: "Issue tracking, comments, CC users, and approval sections." },
  { name: "Approvals", desc: "Authorization queue integrated with self-service and workflows." },
  { name: "Departments", desc: "Organizational departments and structure." },
  { name: "Groups", desc: "Cross-team groups and collaboration." },
  { name: "Users", desc: "Employee directory; admin invite, create users, and password reset." },
  { name: "Notifications", desc: "Notification center (core module)." },
  { name: "Roles & Permissions", desc: "Custom workspace roles and permission assignment." },
  { name: "Workflows", desc: "Event-driven automation definitions and executions." },
  { name: "Forms", desc: "Dynamic HR forms (admin builder; submissions via self-service)." },
  { name: "Human Resources", desc: "HCM hub — employees, services, foundation data, provisioning." },
  { name: "Payroll", desc: "Pay periods, runs, payslips, PDF download, payroll operations." },
  { name: "Time & Attendance", desc: "Attendance admin, imports, integrations, workforce ops." },
  { name: "Report Center", desc: "HR exports, schedules, and document-oriented reporting." },
  { name: "Employee Self-Service", desc: "Leave, attendance, payslips, forms, and approvals portal." },
  { name: "Subscription Status", desc: "Read-only plan state, entitlements, and quotas for workspace admins." },
] as const;

export const HCM_DEPENDENCIES =
  "HR is the foundation module. Payroll, attendance, self-service, and report-center require HR to be enabled. Workflows and approvals operate as process modules alongside HCM.";

export const WORKSPACE_ROLES = [
  { role: "admin", desc: "Workspace administration — users, invitations, settings, and HR configuration." },
  { role: "manager", desc: "Operational management — tickets, departments, and HR actions where permitted." },
  { role: "member", desc: "Standard access with permissions from built-in or custom roles." },
  { role: "Custom roles", desc: "Configurable permission sets including dynamic scopes for departments, groups, workflows, forms, and HR services." },
] as const;

export const PLATFORM_ROLES = [
  "Root Platform Owner (protected; full platform authority)",
  "Platform Admin",
  "Support Admin",
  "Workspace Support",
  "Sales Admin",
  "Finance Admin",
  "Auditor",
  "Read-Only Operator",
] as const;

export const PLATFORM_CONSOLE_AREAS = [
  { title: "Tenant Registry", text: "Workspace-linked tenant profiles, lifecycle, subscription metadata, renewal intelligence, health, evaluation, and entitlement overrides." },
  { title: "Commercial Operations", text: "Commercial accounts, billing contacts, contract terms, invoice records with PDF uploads, payment tracking, and commercial risk dashboard — manual records, not in-app payment processing." },
  { title: "Platform Users", text: "Platform user directory, invitations, activation, role assignment, protected root owner policy, and access review." },
  { title: "Workspaces", text: "Create and manage customer workspaces and workspace-level administration." },
  { title: "Governance Console", text: "Audit integrity, policy violations, workflow analytics, topology and readiness, evidence packages." },
  { title: "Platform Settings", text: "Identity, branding assets, security, deployment, SMTP, features, and multi-tenant configuration categories." },
] as const;

export const HR_CAPABILITIES = [
  "Employee records with detail views, contracts, documents, and job movements",
  "Bulk import/export and employee provisioning linked to user accounts",
  "HR foundation data: employment statuses/types, contract types, work locations, positions, document types, leave and probation policies",
  "Configurable HR services catalog for employee requests",
  "Admin form builder and employee submissions",
  "Leave requests via self-service with approval paths",
  "Attendance: employee clock actions, admin workforce views, import pipelines, and integration sources",
  "Payroll: periods, locks, runs, calculate/approve/finalize operations, payslips with confidentiality masking",
  "Workforce operations and payroll operations consoles",
  "Workspace integrations and platform stabilization diagnostics",
] as const;

export const CLIENT_OUTCOMES = [
  {
    title: "For the organization",
    items: [
      "Operate each company in an isolated workspace with module enablement aligned to subscription entitlements.",
      "Standardize HR, attendance, payroll, and internal operations under one permission model.",
      "Retain administrative control through roles, custom permissions, and approval workflows.",
      "Gain visibility via dashboards, governance views, activity logs, and report exports.",
    ],
  },
  {
    title: "For employees",
    items: [
      "Use self-service for leave, attendance, payslips, and HR form submissions.",
      "Participate in tickets, messages, calendar events, and approval tasks.",
      "Access only modules and actions authorized by workspace administrators.",
    ],
  },
  {
    title: "For platform operators",
    items: [
      "Manage many tenants from a dedicated super-administration console.",
      "Control subscriptions, entitlements, quotas, and workspace access policies.",
      "Maintain commercial records and review platform activity without mixing tenant operational data.",
    ],
  },
] as const;
