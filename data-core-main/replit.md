# Internal Operations Platform

A modern, enterprise-grade **multi-tenant** internal operations hub. Each company gets its own isolated workspace. No public sign-up — platform owner creates workspaces and first admin, admins manage users within their workspace. Supports English and Arabic (RTL).

## Run & Operate

- `pnpm dev` — **start everything** (API server + frontend, color-coded output)
- `pnpm --filter @workspace/api-server run dev` — run the API server only (port 8080)
- `pnpm --filter @workspace/ops-platform run dev` — run the frontend only (Vite, auto port)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL`, `JWT_SECRET`, `SESSION_SECRET`
- Optional env: `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` (for invitation emails)
- See `.env.example` for full list

## Development Reset

To wipe all data and seed a clean default super_admin account:

```bash
pnpm --filter @workspace/scripts run reset-dev
```

After running, sign in with:
- **Employee Number**: `admin`
- **Password**: `admin`
- **Role**: `super_admin`
- Password change is **forced** on first sign-in (`mustResetPassword: true`)

Environment overrides (optional):
- `DEFAULT_ADMIN_EMP` — employee number (default: `admin`)
- `DEFAULT_ADMIN_PASS` — password (default: `admin`)
- `DEFAULT_ADMIN_NAME` — full name (default: `Platform Owner`)
- `DEFAULT_ADMIN_EMAIL` — email (default: `admin@platform.local`)

> ⚠️ The script refuses to run when `NODE_ENV=production`.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite, Tailwind, shadcn/ui, wouter, TanStack Query, i18next (EN/AR RTL)
- Auth: **Self-hosted JWT** — bcrypt (cost 12) + jsonwebtoken; token stored in localStorage; zero external auth dependencies
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for all API contracts)
- `lib/api-spec/orval.config.ts` — Orval codegen config
- `lib/api-zod/src/generated/api.ts` — all Zod validation schemas (auto-generated)
- `lib/api-client-react/src/generated/` — React Query hooks (auto-generated, split mode)
- `lib/db/src/schema/` — Drizzle schema files (one per domain)
  - `workspaces.ts` — workspaces table
  - `invitations.ts` — workspace_invitations table
  - `departments.ts`, `users.ts`, `tickets.ts` — all include `workspaceId` FK
- `lib/db/src/index.ts` — DB connection + schema export
- `artifacts/api-server/src/routes/` — Express route handlers (one file per domain)
  - `workspaces.ts` — GET/POST /workspaces, GET/PATCH /workspaces/me
  - `invitations.ts` — GET/POST /invitations, DELETE /invitations/:id
  - `admin.ts` — POST /admin/users (admin creates Clerk user + DB record)
- `artifacts/api-server/src/middlewares/` — requireAuth, requireWorkspaceAdmin, requireSuperAdmin
- `artifacts/ops-platform/src/pages/` — one file per route
- `artifacts/ops-platform/src/components/layout/` — AppLayout, Sidebar, Header
- `artifacts/ops-platform/src/lib/i18n.ts` — i18next init (EN + AR)

## Multi-tenant Architecture

Every request is workspace-scoped:

1. **requireAuth middleware** resolves the Clerk JWT → looks up DB user → attaches `req.userId`, `req.workspaceId`, `req.userRole`
2. **All route handlers** filter queries by `req.workspaceId` automatically — users can only see their own company's data
3. **User sync flow** (`POST /users`):
   - If user already exists in DB → upsert (update avatar/email)
   - If new user → look for pending `workspace_invitations` by email → create DB record with that workspace + role, mark invitation accepted
   - If no invitation found → 403 "No workspace invitation found"
4. **No workspace = graceful block** — frontend shows a "No workspace access" screen instead of crashing

## Workspace & User Creation Flows

### Platform super-admin creates a new workspace:
```
POST /workspaces
{ name, slug, adminEmail, adminFullName, adminPassword }
```
Creates the workspace + the first admin user in Clerk (via `clerkClient.users.createUser`) + DB record. Requires `super_admin` role.

### Workspace admin invites a user by email:
```
POST /invitations
{ email, role }
```
Creates a Clerk invitation email + a `workspace_invitations` record. When the user clicks the link, signs in, and the `SyncUser` component fires, the invitation is matched and the user record is created with the correct workspace + role.

### Workspace admin creates a user directly (with password):
```
POST /admin/users
{ email, fullName, password, role, departmentId?, position? }
```
Creates the Clerk user account + DB record in one step. No invitation email needed.

## Role Hierarchy

- `super_admin` — platform owner, can create workspaces and users across all workspaces
- `admin` — workspace admin, can manage users/invitations within their workspace
- `manager` — can manage tickets and departments
- `member` — standard user

## Architecture Decisions

- **Contract-first API**: OpenAPI spec drives both client hooks (React Query) and server validators (Zod). Never write raw fetch calls.
- **JWT auth flow**: `POST /auth/login` returns a signed JWT; stored in `localStorage` as `ops_access_token`; `AuthProvider` exposes `useAppAuth()` across the app; all generated hooks call `setAuthTokenGetter` so they automatically attach the token.
- **requireAuth middleware**: Verifies JWT from `Authorization: Bearer <token>` header → looks up DB user → attaches `req.userId`, `req.workspaceId`, `req.userRole`.
- **RTL support**: `i18next-browser-languagedetector` sets the document `dir` attribute dynamically; language toggle is in Settings and the sidebar footer.
- **No public registration**: Sign-in page only — no sign-up link. Accounts are created by admins only.

## Product

- **Dashboard** — stats overview (open tickets, pending approvals, resolved this week), recent activity feed
- **Tickets** — searchable/filterable list, create, full detail view with comment thread, activity timeline, CC users, approval section
- **Departments** — list, create, manage (workspace-scoped)
- **Users** — directory; admins see "Invite by email" + "Create user" buttons + pending invitations tab
- **Notifications** — notification center with mark-read and bulk actions
- **Approvals** — pending approvals queue with approve/reject actions
- **Settings** — theme (light/dark/system), language (EN/AR), profile info, sign-out; admins see Workspace Settings panel

## Super Admin Panel (`/super-admin/*`)

Accessible only by `super_admin` users. Completely separated from workspace layout.

- **Overview** — platform stats (total/active/suspended workspaces, users, tickets), recent workspace & user activity
- **Workspaces** (`/super-admin/workspaces`) — list all workspaces with status badges, search/filter, quick status change (activate/suspend/disable), delete
- **Create Workspace** (`/super-admin/workspaces/new`) — form to create workspace + first admin account in one step; auto-generates slug/URL from name
- **Workspace Detail** (`/super-admin/workspaces/:id`) — per-workspace stats, edit name/logo/color, change status, list all users, reset any user's password
- **Platform Activity** (`/super-admin/activity`) — recent workspace creations and user registrations
- **Platform Settings** (`/super-admin/settings`) — read-only view of platform config (security, domains, roles, data policies)

### Routing logic
- After sign-in, `AuthProvider` captures `role` from `POST /auth/login` response
- `role === "super_admin"` → redirected to `/super-admin` instead of `/dashboard`
- `/super-admin/*` routes are protected by `SuperAdminRoute` — non-super-admins are redirected to `/sign-in`
- Super admins bypass the "no workspace" check (they have no workspace by design)

### New API endpoints (super_admin only)
- `GET /workspaces/:id` — workspace by ID with counts
- `PATCH /workspaces/:id` — update name, logo, color, status
- `DELETE /workspaces/:id` — permanently delete
- `GET /workspaces/:id/stats` — per-workspace statistics
- `GET /workspaces/:id/users` — users in a workspace
- `GET /platform/stats` — platform-wide aggregate stats
- `GET /platform/activity` — recent workspaces and users
- `POST /admin/reset-password` — reset any user's password (bcrypt hash update)

### Bootstrap
- `pnpm --filter @workspace/scripts run setup-owner` — creates the first super_admin account interactively (or via `OWNER_EMPLOYEE_NUMBER`, `OWNER_NAME`, `OWNER_EMAIL`, `OWNER_PASSWORD` env vars)

## User Preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- After running `pnpm --filter @workspace/api-spec run codegen`, do NOT manually edit generated files — they are fully auto-generated.
- The orval zod output uses `mode: "single"` — all schemas go into one file at `lib/api-zod/src/generated/api.ts`.
- Always run `pnpm --filter @workspace/db run push` after adding/changing schema files.
- JWT tokens expire after `JWT_EXPIRES_IN` (default 24h). The frontend does not auto-refresh — users are logged out on expiry.
- Workspace ID is always inferred from the authenticated user — never passed as a URL parameter.
- TanStack Query hooks generated by Orval require `queryKey` in options whenever you pass `query: { enabled: ... }`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
