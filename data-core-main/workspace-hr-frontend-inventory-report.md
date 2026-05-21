# Workspace / HR Frontend Inventory Report

**Discovery date:** 2026-05-19  
**App:** `artifacts/ops-platform` (client workspace UI + super-admin in same SPA)

---

## 1. Layout & navigation

| Component | Path | Purpose |
|-----------|------|---------|
| `AppLayout` | `components/layout/app-layout.tsx` | Workspace shell: sidebar + header + main |
| `Sidebar` | `components/layout/sidebar.tsx` | Dynamic nav from `GET /modules`, permission filter |
| `Header` | `components/layout/header.tsx` | Page title from route |
| `WorkspaceReadOnlyBanner` | `components/workspace/WorkspaceReadOnlyBanner.tsx` | P16-E read-only mode banner |

**Nav source:** `artifacts/api-server/src/seed/modules.ts` — HR entries:

- `/hr` (module `hr`, perm `hr.manage`)
- `/self-service` (module `self-service`, perm `self_service.view`)
- `/users`, `/departments`, `/roles`, etc.

---

## 2. Workspace pages (non-HR)

| Path | Page file | Permission / module | Related API | Status |
|------|-----------|---------------------|-------------|--------|
| `/home` | `home.tsx` | module: home | modules | complete |
| `/dashboard` | `dashboard.tsx` | dashboard.view | dashboard APIs | complete |
| `/users` | `users.tsx` | users.view | users, invitations, roles | complete |
| `/roles` | `roles.tsx` | roles.view | workspace-roles, permissions | complete |
| `/departments` | `departments.tsx` | departments.view | /departments | complete — **legacy org** |
| `/settings` | `settings.tsx` | (none) | profile/password | complete |
| `/groups` | `groups.tsx` | groups.view | groups | complete |
| `/tickets/*` | tickets*.tsx | tickets.* | tickets | complete |
| `/messages` | `messages.tsx` | messages.view | messages | complete |
| `/calendar` | `calendar.tsx` | calendar.view | calendar | complete |
| `/workflows/*` | workflows*.tsx | workflow.view | workflows | complete |
| `/governance` | `governance-dashboard.tsx` | admin roles | governance | partial |
| `/self-service` | `self-service.tsx` | self_service.view | forms, hr services | partial |

---

## 3. HR pages

| Path | Page file | Guard | Related APIs | Status | Notes |
|------|-----------|-------|--------------|--------|-------|
| `/hr` | `hr-dashboard.tsx` | hr.manage + module hr | GET /hr/dashboard | partial | Hub/metrics |
| `/hr/employees` | `hr-employees.tsx` | hr.manage | /hr/employees | complete | List, filters |
| `/hr/employees/new` | `hr-employee-new.tsx` | admin/manager + hr | POST /hr/employees | complete | Create wizard |
| `/hr/employees/:id` | `hr-employee-detail.tsx` | hr.manage | employee nested APIs | complete | Tabs: profile, contracts, docs, leave, etc. |
| `/admin/hr/foundation` | `hr-foundation.tsx` | admin + hr module | /hr/foundation/*, org-units, job-* | complete | Large tabbed admin UI |
| `/hr/services` | `hr-services.tsx` | hr.manage | /hr/services | complete | Employee-facing catalog |
| `/admin/hr/services` | `hr-services-admin.tsx` | admin/manager | /hr/services CRUD | complete | |
| `/admin/hr/services/new` | `hr-services-admin-new.tsx` | admin/manager | POST /hr/services | complete | |
| `/admin/hr/payroll` | `hr-payroll.tsx` | hr.manage | /hr/payroll/* | partial | Components, structures, bands |
| `/admin/hr/payroll/runs/:id` | `hr-payroll-run.tsx` | hr.manage | runs, payslips, process | partial | Run detail |
| `/admin/hr/attendance` | `hr-attendance.tsx` | hr.manage | /hr/attendance/* | partial | Shifts, calendars, records |
| `/self-service/payslips` | `hr-me-payslips.tsx` | module hr | /hr/me/payslips | complete | Employee self |
| `/self-service/leave` | `hr-me-leave.tsx` | module hr | leave-balances, leave-requests | partial | Dual leave backends |

**Admin HR forms (forms module under HR nav):**

| Path | File | Status |
|------|------|--------|
| `/admin/forms`, `/admin/hr/forms` | `admin-forms.tsx` | complete |
| `/admin/forms/new` | `admin-forms-new.tsx` | complete |
| `/admin/forms/:id` | `admin-forms-detail.tsx` | complete |

---

## 4. Super-admin workspace pages (not client workspace, listed for boundary clarity)

| Path | File | Purpose |
|------|------|---------|
| `/super-admin/workspaces` | `super-admin-workspaces.tsx` | List workspaces |
| `/super-admin/workspaces/new` | `super-admin-workspace-new.tsx` | Create workspace |
| `/super-admin/workspaces/:id` | `super-admin-workspace-detail.tsx` | Workspace detail |

Client users with `workspaceId` are **redirected away** from super-admin routes.

---

## 5. Important components (HR-related)

| Component area | Location | Purpose |
|----------------|----------|---------|
| UI primitives | `components/ui/*` | shadcn-style (~55 components) |
| HR utils | `lib/hr-utils.ts` | `toCode`, shared helpers |
| Permissions | `hooks/use-permissions.ts` | RBAC from `/auth/me` |
| Workspace access | `lib/workspace-access-context.tsx` | Read-only enforcement flags |
| API client | `@workspace/api-client-react` | Generated React Query hooks |

No dedicated `components/hr/` folder — HR UI lives primarily in **page files**.

---

## 6. Dialogs / drawers / tables (patterns)

From page inspection (representative):

| Page | UI patterns |
|------|-------------|
| `hr-foundation.tsx` | Tabs, Dialog create/edit, AlertDialog delete, Card lists |
| `hr-employees.tsx` | Data table, search, link to detail |
| `hr-employee-detail.tsx` | Multi-section profile, nested resource tabs |
| `hr-payroll.tsx` | Tabbed payroll config |
| `hr-attendance.tsx` | Calendar/table views, import actions |
| `users.tsx` | Invite dialog, role assignment, department picker (**users not employees**) |

---

## 7. Hooks (HR / workspace)

| Hook | File | API |
|------|------|-----|
| `usePermissions` | `hooks/use-permissions.ts` | GET /auth/me |
| `useApiFetch` | `hooks/use-api-fetch.ts` | Generic fetch (HR foundation uses heavily) |
| `useTenantMemberWorkspaceAccess` | `hooks/use-tenant-workspace-access.ts` | GET /tenant/workspace-access |
| Generated hooks | `api-client-react` | Orval from OpenAPI |

---

## 8. Module ↔ page coverage matrix

| HR domain | DB + API | Dedicated page | Status |
|-----------|----------|----------------|--------|
| Foundation | Yes | hr-foundation.tsx | complete |
| Employees | Yes | employees + detail + new | complete |
| Payroll | Yes | hr-payroll, hr-payroll-run | partial UI depth |
| Attendance | Yes | hr-attendance | partial |
| Leave (structured) | Partial DB | hr-me-leave, self-service | partial |
| HR Services | Yes | hr-services, admin | complete |
| Org units (HR) | Yes | foundation tab only | complete |
| Departments (legacy) | Yes | departments.tsx | complete — duplicate UX |
| Recruitment / LMS / Performance | Catalog only | — | placeholder |

---

## 9. i18n & permissions on UI

- `react-i18next` used on HR foundation and major pages (EN/AR labels in forms).
- `PermissionGate` wraps `ProtectedRoute` children in `App.tsx`.
- Admin/manager bypass full permission list in `use-permissions.ts`.

---

**Confirmation:** Read-only discovery; no frontend files modified.
