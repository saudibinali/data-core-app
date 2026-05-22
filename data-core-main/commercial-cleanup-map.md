# Commercial Cleanup Map

## UI — removed from active path

| Item | Location | Action |
|------|----------|--------|
| Currency / contract value | `ContractTermsSection` | Not used in console |
| Billing cycle / payment terms | `ContractTermsSection` | Not used |
| Change contract status | `ContractTermsSection` | API 410 |
| Invoice amount / due date / status | `InvoicesSection` | Not used |
| Collection tracking | `CollectionTrackingPanel` | Not mounted |
| Commercial risk accordion | `CommercialRiskSection` | Not mounted |
| Payment props on console | `super-admin-tenants.tsx` | Removed |

## API — behavior change

| Endpoint | Change |
|----------|--------|
| `PATCH .../commercial-contracts/:id/status` | 410 Gone |
| `PATCH .../commercial-invoices/:id/status` | 410 Gone |
| `POST commercial-contracts` | No demote-other-active |
| `commercial-payments` router | Unregistered from `routes/index.ts` (verify deploy) |

## API — still accepted but ignored on write

Legacy body keys on contract create (if sent by old clients): `contractValue`, `currency`, `billingCycle`, `renewalType`, `internalOwnerUserId` — not mapped in `mapBodyToInsert`.

## DB — retained columns (archived)

### `commercial_contract_terms`

`contract_value`, `currency`, `billing_cycle`, `payment_terms`, `renewal_type`, `renewal_commitment_status`, `internal_owner_user_id`, `customer_decision_maker_*`, `renewal_notes`, legacy `status`.

### `commercial_invoices`

`invoice_amount`, `currency`, `due_date`, `invoice_date`, `billing_period_*`, `external_accounting_*`, legacy `status`.

**Do not DROP** without explicit data archival project.

## DB — new / used

| Column / table | Purpose |
|----------------|---------|
| `company_name`, `responsible_person_*`, `notes` on contracts | Operational fields |
| `responsible_person_*`, `reminder_date` on invoices | Operational fields |
| `commercial_contract_documents` | Contract PDF 1:1 |

## Hooks replaced

| Old | New |
|-----|-----|
| ERP contract hooks in `use-commercial-contracts` (if any) | Operational types + PDF mutations |
| Invoice hooks with amount/status | `use-commercial-invoices` operational |

## Tests updated

- `commercial-contracts.test.ts`
- `commercial-invoices.test.ts`
- `commercial-tab-contracts.test.ts`
- `commercial-tab-invoices.test.ts`
- `commercial-console-integration.test.ts`

## Tests may still reference legacy files

- `commercial-collection-tracking.test.ts` — legacy panel still exists
- `phase-15-closure.test.ts` — may list old filenames; update when running full closure suite

## Runbook

```bash
# Migration (requires DATABASE_URL)
node scripts/migrate-commercial-simplification.cjs

# Verify
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/ops-platform test
```
