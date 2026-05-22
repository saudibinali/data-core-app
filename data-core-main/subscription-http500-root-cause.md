# Subscription HTTP 500 — Root Cause

## Symptom

`POST /api/platform/tenants/:tenantId/subscription` returned **HTTP 500** when creating a subscription from `/super-admin/tenants` → Subscription → **Create Subscription**, typically with only required fields (code + name) and optional dates/contracts left empty.

## Root cause

In `artifacts/api-server/src/routes/workspace-subscriptions.ts`, optional fields use internal sentinels:

- `parseDate(undefined)` → `"MISSING"`
- `parseOptionalId(undefined)` → `"MISSING"`

Only **`startDate`** was converted to SQL `null` before insert:

```typescript
startDate: startDate === "MISSING" ? null : startDate,
```

These were passed through **unchanged** into Drizzle insert:

- `endDate`
- `renewalDate`
- `commercialAccountId` (when omitted from JSON)
- `activeContractTermId` (when omitted)

PostgreSQL `date` / `integer` columns received the literal string `"MISSING"` (or invalid coercion), causing a **database driver error** surfaced as HTTP 500.

## Why it appeared after cleanup

The canonical route (`workspace-subscriptions.ts`) was already correct for P16 semantics, but the UI was simplified to send a **minimal payload** (optional dates omitted). The old P13 path may have always sent explicit nulls or more fields. After cleanup, Create Subscription matches the minimal payload path and hit this latent parser bug.

## Not the cause

- Route shadowing (P13 subscription routes removed; POST handled only by `workspace-subscriptions.ts`)
- Missing `workspace_subscriptions` table (would be a different SQL error)
- FK violations on null commercial/contract IDs (null is valid)
- Frontend sending wrong endpoint (uses `/api/platform/tenants/:id/subscription` correctly)

## Fix

Added `dateFieldToNull()` and `optionalIdToNull()` and applied them to **all** optional POST/PATCH fields before validation and DB writes.

Regression test: `persists null for omitted optional dates and foreign keys (not MISSING sentinel)` in `workspace-subscriptions.test.ts`.
