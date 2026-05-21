# Workspace Current Architecture Report

**Discovery date:** 2026-05-19  
**Scope:** Workspace definition, tenancy boundary, settings, users, modules, navigation — **read-only inventory**

---

## 1. What is a Workspace in this codebase?

A **Workspace** is the **tenant isolation boundary** for all client (organization) data.

- **Table:** `workspaces` (`lib/db/src/schema/workspaces.ts`)
- **Primary key:** `id` (serial)
- **Convention:** Platform APIs use path param `:tenantId` which maps to `workspaces.id` (1:1 tenant ↔ workspace). Comments in `tenants.ts` and resolvers treat `tenantId === workspaceId`.
- **Rule:** One commercial customer maps to **one workspace**; there is no multi-workspace-per-tenant model in schema.

### Core columns (`workspaces`)

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `name` | text | Display name |
| `slug` | text unique | URL-safe identifier |
| `logo_url` | text | Branding |
| `primary_color` | text | Branding |
| `status` | text default `active` | API also allows `suspended`, `disabled` (super_admin PATCH) |
| `created_at`, `updated_at` | timestamptz | |

There is **no** `tenant_id` column on `workspaces`. Tenancy is the workspace row itself.

---

## 2. Relationship to “tenant”

| Concept | Implementation |
|---------|----------------|
| **Tenant (commercial/platform)** | `workspaces.id` referenced as `tenantId` in `/platform/tenants/:tenantId/*` routes |
| **Tenant subscription (legacy P13)** | `tenant_subscriptions.workspace_id` UNIQUE |
| **Tenant subscription (P16)** | `workspace_subscriptions.workspace_id` UNIQUE |
| **Workspace member** | `users.workspace_id` NOT NULL for client users |
| **Platform operator** | `users.workspace_id IS NULL` |

**Out of scope for this report:** billing, commercial accounts, subscription enforcement (separate layers on same `workspace_id`).

---

## 3. How `workspaceId` flows through the stack

```
JWT (auth.ts) → payload.workspaceId from users.workspace_id
     ↓
requireAuth → req.workspaceId
     ↓
Route handlers → eq(table.workspaceId, req.workspaceId)
     ↓
Frontend → auth.user.workspaceId required for AppLayout routes
```

**Global write guard (P16-E):** `workspaceAccessWriteGuard` blocks POST/PUT/PATCH/DELETE when workspace enforcement is read-only (exempts `/platform/*`, `/auth/*`, etc.).

---

## 4. Tables directly defining Workspace

| Table | File | Purpose |
|-------|------|---------|
| `workspaces` | `workspaces.ts` | Tenant root entity |
| `workspace_module_settings` | `modules.ts` | Per-workspace enable/disable of platform modules |
| `platform_modules` | `modules.ts` | Global module catalog (not workspace-scoped) |
| `workspace_custom_roles` | `custom-roles.ts` | Custom RBAC roles |
| `workspace_role_permissions` | `custom-roles.ts` | Permission strings per custom role |
| `workspace_invitations` | `invitations.ts` | Email invites to join workspace |
| `workspace_event_logs` | `events.ts` | Workspace-scoped event stream |
| `hr_workspace_settings` | `hr.ts` | HR numbering mode per workspace |
| `hr_workspace_counters` | `hr.ts` | Atomic counters (e.g. employee numbers) |

**Phase 16 workspace tables** (schema exists; may not be in applied migration `0000_sad_midnight.sql` — verify before deploy):

- `workspace_subscriptions`, `workspace_entitlements`, `workspace_quota_limits`, `workspace_subscription_policies`, `workspace_access_enforcement`

---

## 5. Tables using `workspace_id` (operational domain)

From migration `lib/db/drizzle/0000_sad_midnight.sql` — **40+ tables** include `workspace_id`, including:

**Organization (non-HR legacy):** `departments`, `groups`  
**Users & access:** `users`, `user_departments`  
**Productivity:** `tickets`, `messages`, `calendar_events`, `notifications`, `approvals`, `activity_logs`  
**Automation:** `workflow_definitions`, `workflow_executions`, `workflow_tasks`, `form_definitions`, `form_submissions`  
**HR (full list in `hr-database-inventory-report.md`):** `employees`, all `hr_*` tables, etc.

**No `tenantId` column** appears on workspace-scoped operational tables — only `workspace_id`.

---

## 6. Workspace settings

| Setting store | Location | Contents |
|---------------|----------|----------|
| **Workspace profile** | `workspaces` row | name, slug, logo, color, status |
| **Module toggles** | `workspace_module_settings` | `module_key` + `enabled` per workspace |
| **HR numbering** | `hr_workspace_settings` | `numbering_mode` (auto \| manual \| hybrid), `numbering_start_from` |
| **HR counters** | `hr_workspace_counters` | Composite PK `(workspace_id, counter_name)` |

There is **no** generic `workspace_settings` JSON table beyond HR-specific settings.

---

## 7. Workspace status & lifecycle

| Layer | Status values |
|-------|----------------|
| **DB / workspaces API** | `active`, `suspended`, `disabled` |
| **Platform lifecycle (P13)** | `pending_activation`, `active`, `suspended`, `locked`, `archived` (maps `archived` → DB `disabled`) — `workspace-lifecycle.ts` |

HR and operational routes generally **do not** re-check workspace lifecycle; they rely on auth + module flags + optional P16-E write guard.

---

## 8. Workspace users

| Aspect | Detail |
|--------|--------|
| **Table** | `users` with `workspace_id` set |
| **Built-in roles** | `super_admin`, `admin`, `manager`, `member` (text `role` column) |
| **Custom RBAC** | `member` + `custom_role_id` → `workspace_role_permissions` |
| **Link to HR** | `employees.user_id` optional FK to `users.id` |
| **APIs** | `/users` (workspace-scoped), `/invitations`, `/workspace-roles` |
| **Separate from** | Platform users (`workspace_id IS NULL`) — **out of scope** |

**Departments (legacy):** `departments` + `user_departments` tie **users** to flat departments — parallel to HR `hr_org_units`.

---

## 9. Workspace modules & navigation

| Piece | Location |
|-------|----------|
| **Seed catalog** | `artifacts/api-server/src/seed/modules.ts` |
| **API** | `GET /modules`, `PATCH /modules/:key` (admin) |
| **Frontend nav** | `sidebar.tsx` reads `useListModules()`, filters by `permissionKey` |
| **Route gating** | `App.tsx` `ProtectedRoute` with `moduleKey` |

**HR-related module keys in seed:** `hr`, `self-service`, plus org modules (`users`, `departments`, …).

**Note:** `self_service.view` is required by `/self-service` route but is **not** listed in `STATIC_PERMISSION_GROUPS` in `workspace-roles.ts` — potential permission catalog gap.

---

## 10. Workspace navigation & dashboards (client UI)

**App:** `artifacts/ops-platform` (single SPA; workspace + super-admin).

| Area | Path | Module key |
|------|------|------------|
| Home | `/home` | `home` |
| Dashboard | `/dashboard` | `dashboard` |
| HR hub | `/hr` | `hr` |
| HR Foundation | `/admin/hr/foundation` | `hr` (admin route) |
| Employees | `/hr/employees` | `hr` |
| Self-service | `/self-service` | `self-service` |
| Departments (legacy) | `/departments` | `departments` |
| Users (login accounts) | `/users` | `users` |
| Roles | `/roles` | `roles` |
| Settings | `/settings` | (none) |

**Layout:** `AppLayout` + `Sidebar` + `Header`; optional `WorkspaceReadOnlyBanner` from subscription enforcement context.

**Super-admin workspace management** (separate shell): `/super-admin/workspaces`, `/super-admin/workspaces/:id` — not client workspace app.

---

## 11. APIs — workspace shell (non-HR)

| Method | Path | File | Scope |
|--------|------|------|-------|
| GET | `/workspaces/me` | `workspaces.ts` | Current workspace profile |
| PATCH | `/workspaces/me` | `workspaces.ts` | Admin updates branding |
| GET/PATCH | `/modules`, `/modules/:key` | `modules.ts` | Module enablement |
| CRUD | `/departments/*` | `departments.ts` | Legacy org (parallel to HR) |
| CRUD | `/workspace-roles/*` | `workspace-roles.ts` | Custom roles + `/permissions` registry |
| CRUD | `/invitations` | `invitations.ts` | Workspace invites |
| CRUD | `/users/*` | `users.ts` | Workspace login users |

Super-admin: `POST/GET/PATCH/DELETE /workspaces`, `/workspaces/:id/stats`, `/workspaces/:id/users`.

---

## 12. Ambiguities & design issues

1. **Dual organization models:** `departments` (legacy, user-centric) vs `hr_org_units` (HR tree: company/branch/division/department/team). Both are active; APIs and UI both exist.
2. **Dual employee/user concepts:** `users` (auth) vs `employees` (HR record); optional `employees.user_id` link — not every employee has login.
3. **Dual leave models:** `hr_employee_leaves` (simpler) vs `leave_requests` + `leave_approval_steps` (structured lifecycle). Schema for `leave_requests` exists; **not present in `0000_sad_midnight.sql` migration** — runtime risk if DB not migrated separately.
4. **Employee `status` text** vs **`hr_employee_statuses` lookup table** — employee row uses free text; foundation provides configurable statuses — possible desync.
5. **Tenant vs workspace naming** in code paths confuses onboarding; IDs are the same integer.
6. **HR settings vs workspace settings** — only HR numbering in `hr_workspace_settings`; no unified workspace admin settings page for all subsystems.
7. **`self_service.view`** permission used in routes but absent from static permission matrix API.
8. **Entitlement catalog** lists `recruitment`, `onboarding`, `performance`, `lms`, etc. — **no matching HR tables/routes** in workspace scope (catalog ahead of implementation).

---

## 13. Key file index

| Area | Path |
|------|------|
| Workspace schema | `lib/db/src/schema/workspaces.ts` |
| Modules schema | `lib/db/src/schema/modules.ts` |
| HR schema (large) | `lib/db/src/schema/hr.ts` |
| Departments schema | `lib/db/src/schema/departments.ts` |
| Workspace routes | `artifacts/api-server/src/routes/workspaces.ts` |
| HR routes (monolith) | `artifacts/api-server/src/routes/hr.ts` (~4000+ lines) |
| Leave routes | `artifacts/api-server/src/routes/leave.ts` |
| Auth / workspace context | `artifacts/api-server/src/middlewares/requireAuth.ts` |
| Module seed | `artifacts/api-server/src/seed/modules.ts` |
| Client routes | `artifacts/ops-platform/src/App.tsx` |
| HR Foundation UI | `artifacts/ops-platform/src/pages/hr-foundation.tsx` |

---

**Confirmation:** This report is documentation only; no code was modified.
