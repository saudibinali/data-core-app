# Platform Users Custom Access Control (Phase 17)

Enterprise platform administration accounts: directory and lifecycle, custom permission overrides, super-admin protection policies, access review, invitation/activation, and a unified console. This is **platform-scoped metadata and policy control only** — not tenant/workspace user management, email delivery, password reset, MFA/SSO, or billing.

## Overview

Phase 17 delivers a complete control plane for internal platform operators:

| Sub-phase | Purpose |
|-----------|---------|
| **P17-A** | Platform user directory and lifecycle (create, list, profile, status) |
| **P17-B** | Custom platform permission grants/denies and effective permission resolution |
| **P17-C** | Super-admin protection policies (protected users, last owner, self-action blocks) |
| **P17-D** | Access review summaries, audit timeline, review metadata (no permission mutation) |
| **P17-E** | Invitation and activation tokens (no email sending) |
| **P17-F** | Unified Platform Users console (summary, table, drawer tabs) |
| **P17-G** | Closure, QA, documentation, formal sign-off |

Commercial billing and workspace subscriptions remain separate — see [commercial-administration.md](./commercial-administration.md) and [subscription-entitlement-control.md](./subscription-entitlement-control.md).

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│ Super Admin — Platform Users console (P17-F)                         │
│   Summary cards → Directory table → Detail drawer (6 tabs)           │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ platform APIs (permission-gated)
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│ users (workspaceId IS NULL)                                          │
│ platform_user_permission_overrides                                   │
│ platform_user_invitations (tokenHash only)                           │
│ platform_user_access_reviews (optional review metadata)              │
│ activity_logs (platform-scoped audit)                                │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ resolvers / evaluators
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Effective permissions │ Protection evaluator │ Access review        │
│ Invitation lifecycle  │ Console aggregation (read-only)            │
└──────────────────────────────────────────────────────────────────────┘
```

**Key rules:**

- Platform users are rows in `users` where `workspaceId IS NULL`.
- Effective permissions = role matrix ∪ grants − denies (**deny wins**).
- Protection policies block unsafe changes before mutations run.
- Invitations store **hashed tokens only**; activation URL shown once in UI.
- Access review is visibility + optional review notes — it does not change permissions or status.

## Platform user lifecycle (P17-A)

**Statuses:** `invited`, `active`, `disabled`, `suspended`, `locked`

**APIs** (`/platform/users`):

| Method | Path | Permission |
|--------|------|------------|
| GET | `/platform/users` | `platform.users.read` |
| GET | `/platform/users/:userId` | `platform.users.read` |
| POST | `/platform/users` | `platform.users.create` |
| PATCH | `/platform/users/:userId` | `platform.users.update` |
| PATCH | `/platform/users/:userId/status` | `platform.users.disable` / `platform.users.status.update` |
| PATCH | `/platform/users/:userId/role` | `platform.users.role.update` |

**Rules:**

- Email normalized to lowercase on create; email change not supported on profile PATCH.
- No hard delete.
- `platform_owner` user type cannot be created via API.
- Root owner flag is immutable via profile update.
- Disable/suspend requires reason (min 10 chars) and confirmation.

## Custom permission overrides (P17-B)

**Table:** `platform_user_permission_overrides` (grant | deny per permission code)

**APIs** (`/platform/users/:userId/permissions`):

- GET — effective permission breakdown
- PUT — bulk overrides (reason required)
- PATCH/DELETE — single override (reason required)

**Permissions:** `platform.permissions.read`, `platform.permissions.update` (root-only for updates in matrix)

**Rules:**

- Only codes from `PLATFORM_PERMISSION_CODES` (platform catalog).
- Cannot grant/deny permissions the actor does not hold (unless root).
- Protected/root targets require root actor for override changes.
- All changes audited (`platform_permission_override_*`).

## Effective permission resolution

**Module:** `platform-effective-permissions.ts`

```
effective = (rolePermissions ∪ grantedOverrides) \ deniedOverrides
```

Used by:

- `requirePlatformPermission` middleware (via actor effective set)
- Access review user detail
- Console permission tab

## Super Admin protection policies (P17-C)

**Config:** `platform-admin-protection-policy-config.ts` (static defaults, safe snapshot for UI)

**Evaluator:** `evaluatePlatformAdminProtection()` — central gate for:

- Disable/suspend/reactivate
- Role change
- Permission override changes
- Root owner flag changes (always blocked)

**Defaults:**

- `minActiveRootOwners = 1`, `minActivePlatformOwners = 1`
- `preventSelfDisable`, `preventSelfDemotion`, `preventLastOwnerDisable`
- `preventLastOwnerCriticalPermissionDeny`
- `emergencyAccessMode = disabled`

**Protected users:** `isProtected` or root owner — non-root actors cannot manage invitations/overrides/status for them without policy allowance.

## Access review and audit (P17-D)

**APIs:**

| Method | Path | Permission |
|--------|------|------------|
| GET | `/platform/access-review/summary` | `platform.accessReview.read` |
| GET | `/platform/access-review/users/:userId` | `platform.accessReview.read` |
| GET | `/platform/access-review/audit-events` | `platform.accessReview.read` |
| POST | `/platform/access-review/users/:userId/review` | `platform.accessReview.update` |

**Risk criteria:** critical effective permissions, custom overrides, stale login, protection flags.

**Audit metadata:** Sanitized before API response (`sanitizeAuditMetadataForReview`) — no raw secrets, no token hashes.

**POST review:** Records `platform_access_review_recorded` only — does not change permissions, roles, or user status.

## Invitation and activation (P17-E)

**Table:** `platform_user_invitations` — `tokenHash` only, statuses: `pending`, `accepted`, `expired`, `revoked`

**APIs:**

| Method | Path | Auth |
|--------|------|------|
| GET | `/platform/invitations/verify?token=` | Public |
| POST | `/platform/invitations/accept` | Public |
| GET | `/platform/users/:userId/invitations` | `platform.invitations.read` |
| POST | `/platform/users/:userId/invitations` | `platform.invitations.create` |
| POST | `/platform/users/:userId/invitations/resend` | `platform.invitations.create` |
| POST | `/platform/invitations/:invitationId/revoke` | `platform.invitations.revoke` |

**Rules:**

- Token shown once on create/resend (`shownOnce: true` in API response).
- Default expiry 7 days.
- One pending invitation per user (old pending revoked with system reason on replace).
- Accept sets user `active`, bcrypt password, employee number — no password stored on invitation row.
- **No email/SMTP** in this phase.

**Activation UI:** `/platform/activate?token=...` (ops platform public route)

## Unified Platform Users console (P17-F)

**Route:** `/super-admin/platform-users`

**Summary cards:** Totals from `GET /platform/users/console-summary`

**Table:** Enriched directory with overrides count, invitation status, risk, last reviewed

**Detail drawer tabs:**

1. Overview — profile, status/role lifecycle
2. Permissions — P17-B UI
3. Protection — policy snapshot, blocked actions
4. Invitations — P17-E UI
5. Access Review — P17-D visibility + mark reviewed
6. Audit — sanitized event timeline

**Navigation:** Primary: Dashboard, Tenants, Commercial, Platform Users, Access Review; More: Workspaces, Activity, Event Log, Settings

## Permissions (final count: 55)

Phase 17 added:

- `platform.accessReview.read`, `platform.accessReview.update` (P17-D)
- `platform.invitations.read`, `platform.invitations.create`, `platform.invitations.revoke` (P17-E)

Existing platform user permissions (P14/P17-A/B): `platform.users.*`, `platform.permissions.*`, `platform.users.role.update`, etc.

Role matrix was **not redesigned** in Phase 17; `platform_admin` receives all permissions except `platform.permissions.update` and `platform.accessReview.update`.

## APIs overview (aggregation — P17-F)

| Method | Path | Permission |
|--------|------|------------|
| GET | `/platform/users/console-summary` | `platform.users.read` |
| GET | `/platform/users/:userId/console` | `platform.users.read` |

Read-only bundles for console UI; no new mutation semantics.

## Audit events

Representative action codes (platform-scoped, `workspaceId` null in logs):

- `platform_user_created`, `platform_user_profile_updated`, `platform_user_status_changed`, `platform_user_disabled`, `platform_user_suspended`, `platform_user_reactivated`
- `platform_user_role_changed`, `platform_user_role_change_blocked`
- `platform_permission_override_granted`, `platform_permission_override_denied`, `platform_permission_override_cleared`
- `platform_user_status_change_blocked`, `platform_user_access_policy_violation`
- `platform_access_review_recorded`
- `platform_user_invitation_created`, `platform_user_invitation_resent`, `platform_user_invitation_revoked`, `platform_user_invitation_accepted`, `platform_user_invitation_expired`, `platform_user_invitation_blocked`

Audit metadata must not include plain invitation tokens or `tokenHash`.

## Safety boundaries

Phase 17 explicitly does **not** include:

| Out of scope | Notes |
|--------------|-------|
| Role matrix redesign | Matrix unchanged except new permission codes |
| Approval workflow | `requireTwoStepApprovalForRootChanges = false` |
| Emergency access | `emergencyAccessMode = disabled` |
| Email / SMTP | Invitations are link-copy only |
| Password reset / MFA / SSO | Not in platform user surfaces |
| Tenant/workspace users | `workspaceId IS NULL` filter enforced |
| Tenant/workspace invitations | Separate `invitations` table for workspaces |
| Root owner promotion/removal | Root flag immutable |
| Hard delete users | Status transitions only |
| Destructive bulk actions | No bulk disable/delete APIs |
| Payment / Stripe / checkout | Commercial phase separate |
| Subscription enforcement changes | Phase 16 scope |

## Known limitations

- **No email delivery** for invitations — operators must copy activation URL manually.
- **No password reset flow** — activation sets initial password; ongoing reset is out of scope.
- **Console directory enrichment** is eventually consistent with list page size (client filters on loaded page + summary map).
- **Policy evaluation** uses active user counts at request time — not a distributed lock.
- **Access review** risk scoring is heuristic, not a compliance certification.
- **E2E tests** against live database are not part of Phase 17 — unit/static tests only.

## Future phases

Phase 17 is closed. **Phase 18 (Tenant Workspace Administration)** is not started by P17-G.

Potential future work (not committed):

- Email notification channel for invitations
- Scheduled access review campaigns
- Server-side directory pagination with enriched filters
- Optional approval workflow for sensitive platform changes
