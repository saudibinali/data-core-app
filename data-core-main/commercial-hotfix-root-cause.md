# Commercial Hotfix — Root Cause

## Symptom

`POST /api/platform/tenants/:tenantId/commercial-contracts` returned **HTTP 500** after the operational simplification refactor.

## Root causes (confirmed)

### 1. Database schema drift (most common in runtime)

Operational columns (`company_name`, `responsible_person_*`, `notes`) and table `commercial_contract_documents` are required by the new API/UI. If `scripts/migrate-commercial-simplification.cjs` was not applied, PostgreSQL raises:

- `42703` — undefined column
- `42P01` — undefined relation

The API previously surfaced this as an unhandled exception → **500** with no actionable message.

**Fix:** Run migration; API now returns **503** with explicit instruction and `detail` from PostgreSQL (logged via `console.error`).

### 2. Commercial account not loaded for contracts-only users

`CommercialConsole` only called `useCommercialAccount` when `canReadAccount` was true. Users with **contracts.read** but without **accounts.read** received `commercialAccountId={undefined}`:

- “Add contract” hidden or save no-op
- Perceived as broken UI / failed create

**Fix:** Load commercial account whenever any commercial section needs it; panels also self-fetch account by `tenantId`.

### 3. Date sentinel edge cases

Legacy `parseDate(undefined) → "MISSING"` combined with incomplete normalization could pass invalid values in edge payloads.

**Fix:** `parseOptionalDate()` in `commercial-route-utils.ts` — omitted dates → `null`, never `"MISSING"` in insert payload.

### 4. Response serialization

`toOperationalContract` / `toOperationalInvoice` assumed `createdAt` was always a `Date` object.

**Fix:** `toIsoTimestamp()` accepts `Date | string`.

## Not the cause

- PDF upload middleware on create (upload is separate `POST .../document`)
- Status workflow (removed; returns 410)
- Single-active contract demotion (removed)

## Verification

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/__tests__/commercial-contracts.test.ts
```

Includes create with contact fields and **no dates** (regression for nullable insert).
