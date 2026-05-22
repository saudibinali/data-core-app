# Invoices & Documents Refactor Plan

## Before

- Invoice amount, currency, due date, status lifecycle, billing period, external accounting references.
- Collection tracking panel tied to payment records.
- Status PATCH (issued/paid/overdue semantics).

## After

**Document records only** — invoice number, link to contract, responsible contact, reminder date, PDF, notes, upload metadata.

## API (`artifacts/api-server/src/routes/commercial-invoices.ts`)

| Method | Path | Behavior |
|--------|------|----------|
| GET | `/platform/tenants/:id/commercial-invoices` | Timeline ordered by `createdAt` desc |
| POST | `.../commercial-invoices` | Create record; `status` fixed to `shared` internally |
| PATCH | `.../commercial-invoices/:invoiceId` | Update operational fields |
| POST | `.../commercial-invoices/:invoiceId/document` | PDF upload |
| GET | `.../commercial-invoices/:invoiceId/document` | PDF download |
| PATCH | `.../status` | **410 Gone** |

## Removed from create/update validation

- `invoiceAmount`, `currency`, `dueDate`, `invoiceDate` ordering rules
- `billingPeriodStart` / `billingPeriodEnd`
- `externalAccountingSystemName` / `externalAccountingReference`
- Invoice status transitions

## Preserved behavior

- Unique `invoiceNumber` per tenant (DB constraint).
- `contractTermId` must belong to same tenant commercial account.
- `uploadedAt` / `uploadedBy` from `commercial_invoice_documents` row in list DTO.

## Migration backfill

```sql
UPDATE commercial_invoices SET reminder_date = COALESCE(reminder_date, due_date)
WHERE reminder_date IS NULL AND due_date IS NOT NULL;
```

## UI (`OperationalInvoicesPanel.tsx`)

- Vertical timeline (newest in query order).
- Linked contract dropdown from tenant contracts.
- PDF upload prominent; "Missing PDF" indicator when `hasDocument` is false.

## Collection / payments

- Not mounted in `CommercialConsole`.
- `commercial-payments` routes remain in codebase but are not part of simplified commercial tab UX.
