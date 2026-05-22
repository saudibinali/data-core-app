# Contracts Refactor Plan

## Before

- ERP-style fields: currency, value, billing cycle, payment terms, commitment, renewal type, owner user, manual status workflow.
- Single-active contract demotion on new create.
- Status PATCH with reason gates.

## After

Operational **timeline records** with optional final PDF.

## API (`artifacts/api-server/src/routes/commercial-contracts.ts`)

| Method | Path | Behavior |
|--------|------|----------|
| GET | `/platform/tenants/:id/commercial-contracts` | All contracts, newest first, operational DTO + reminders |
| GET | `.../commercial-contracts/:contractId` | Single contract |
| POST | `.../commercial-contracts` | Append new record (no demotion) |
| PATCH | `.../commercial-contracts/:contractId` | Edit metadata fields |
| POST | `.../commercial-contracts/:contractId/document` | Upload/replace PDF |
| GET | `.../commercial-contracts/:contractId/document` | Download PDF stream |
| PATCH | `.../status` | **410 Gone** — workflow removed |

## Body mapping

Accepts both legacy and operational keys for dates:

- `startDate` / `contractStartDate`
- `endDate` / `contractEndDate`
- `renewalReminderDate` / `renewalDate`

Legacy ERP fields are **ignored** on insert (not written from UI).

## Storage

- Table: `commercial_contract_documents` (1:1 per contract).
- Lib: `contract-document-storage.ts`, `parse-contract-pdf-upload.ts`.

## UI (`OperationalContractsPanel.tsx`)

- List with start/end, reminder badge, contact, PDF actions.
- Form: simplified fields only.
- "Add contract record" — never replaces prior contracts.

## Data retention

Existing rows keep legacy columns (`contract_value`, `currency`, etc.) in PostgreSQL for audit; they are omitted from API responses and UI.

## Tests

- `commercial-contracts.test.ts` — operational create, 410 status, PDF endpoints, `db.select` list mock.
