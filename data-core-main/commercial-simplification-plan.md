# Commercial Simplification Plan

## Objective

Transform Enterprise HCM commercial modules from a **fake ERP billing console** into **operational SaaS commercial tracking** at `/super-admin/tenants` → Commercial → Contracts / Invoices & Documents.

## Scope

| In scope | Out of scope |
|----------|----------------|
| Contract timeline + PDF archive | Accounting, AR, tax |
| Invoice document timeline + PDF | Payment collection engine |
| Super-admin reminders | Customer-facing billing |
| Safe DB migration + API/UI refactor | Deleting historical tenant data |
| Subscription / commercial account preservation | Replacing workspace_subscriptions |

## Principles

1. **No data loss** — legacy columns remain in DB; unused values stay as archived metadata.
2. **Multiple records** — contracts and invoices append to history; no demotion/replace of prior rows.
3. **External truth** — negotiation, signature, payment, and collection happen outside the platform.
4. **Admin-only alerts** — reminders inform platform operators, not automated customer billing.

## Phases (implemented)

### Phase A — Schema & migration

- `scripts/migrate-commercial-simplification.cjs` adds operational columns and `commercial_contract_documents`.
- Backfill: decision-maker → responsible person; `due_date` → `reminder_date` where applicable.

### Phase B — API

- `commercial-contracts.ts` — operational DTOs, PDF upload/download, status route **410**.
- `commercial-invoices.ts` — document-only create/update, status route **410**.
- `commercial-operational.ts` — reminder derivation (contract end, renewal, invoice reminder).
- Payments router **unregistered** from default commercial tab (route file may remain for legacy reads).

### Phase C — UI

- `OperationalContractsPanel` + `OperationalInvoicesPanel`.
- `CommercialConsole` — account, contracts, invoices only (no collection/risk accordion).
- Hooks: `use-commercial-contracts.ts`, `use-commercial-invoices.ts`.

### Phase D — Verification

- Vitest updates for operational API and static UI gates.
- Build api-server + ops-platform before deploy.
- Run migration against staging/production with `DATABASE_URL`.

## Field model (canonical)

### Contracts

`contractNumber`, `contractTitle`, `companyName`, `responsiblePerson*`, `startDate`, `endDate`, `renewalReminderDate`, PDF, `notes`.

### Invoices

`invoiceNumber`, `contractTermId`, `responsiblePerson*`, PDF, `reminderDate`, `notes`, `uploadedAt` / `uploadedBy` (from document row).

## Rollback

- UI rollback: revert ops-platform deploy; old section components remain in repo.
- API rollback: re-register legacy routers only if needed; prefer forward-fix.
- DB: migration is additive only; no rollback required for column adds.

## Success criteria

- Super-admin can add multiple contracts/invoices per tenant without replacing prior rows.
- PDF upload/download works for both entity types.
- Reminder badges visible on list/timeline.
- No amount/currency/status/billing-cycle fields in create forms or POST bodies.
