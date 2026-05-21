# Commercial Administration (Phase 15)

Platform/Super Admin module for enterprise commercial operations: accounts, contracts, invoices, manual collection, and risk intelligence. This is **not** a full billing engine, accounting system, or payment gateway.

## Purpose

Give platform operators a single place to:

- Maintain commercial account and billing contact records
- Manage contract terms and renewal commitment status
- Track invoice records with **uploaded PDF documents only**
- Record and verify **manual** off-platform payments
- View computed commercial risk and renewal readiness
- Let tenants **read** their own invoice list and download PDFs (no payment)

## What the platform manages

| Area | Capability |
|------|------------|
| Commercial account | CRUD via platform (no delete) |
| Billing contacts | Create/update, set primary (no delete) |
| Contracts | Terms, renewal dates, commitment status |
| Invoices | Manual records, status workflow, PDF upload/download |
| Collection | Manual payment records, verification/rejection/reversal |
| Risk | Read-only scoring from contracts + invoices + payments |
| Tenant billing portal | Read-only invoice list + PDF download |

## What the platform does **not** do

- Electronic payment, Stripe, checkout, card storage, payment gateways
- Invoice **generation** or tax/ZATCA calculation
- Accounting ledger or GL posting
- Email sending, automated dunning, automated renewal actions
- Customer self-service payment or “Pay Now”
- Hard delete of commercial records
- Custom per-user permission overrides (fixed role matrix only)

## Lifecycle (recommended order)

1. **Commercial account** — legal/billing identity on file  
2. **Billing contacts** — finance/procurement/contract owners  
3. **Contract terms** — dates, renewal notice, commitment status  
4. **Invoice record** — issue/share status, amounts, dates  
5. **Invoice PDF** — upload PDF (only source of invoice document)  
6. **Collection** — record manual payments; finance verifies  
7. **Risk & readiness** — computed signals (no stored score table)

## Permissions (summary)

**Platform commercial (14 codes):**

- `commercial.accounts.read` / `commercial.accounts.update`
- `commercial.contacts.read` / `commercial.contacts.update`
- `commercial.contracts.read` / `commercial.contracts.update`
- `commercial.invoices.read` / `commercial.invoices.update`
- `commercial.invoiceDocuments.read` / `commercial.invoiceDocuments.upload`
- `commercial.payments.read` / `commercial.payments.record` / `commercial.payments.verify`
- `commercial.risk.read`

**Tenant billing (2 codes):**

- `tenant.billing.invoices.read`
- `tenant.billing.invoiceDocuments.download`

Total platform permissions: **32** (18 core + 14 commercial/billing).

Roles are defined in `platform-permissions` / `platform-permissions-config` — no custom matrix redesign in Phase 15.

## Safety boundaries

Enforced in `COMMERCIAL_SAFETY_CONTRACT` (frontend import-time guard) and backend route design:

- Manual payments only; no gateway integration  
- Uploaded invoice PDFs only; no generation engine  
- Risk APIs are GET-only; no automated status changes from risk  
- Audit on sensitive commercial actions; metadata redacted in activity feeds  
- No destructive DELETE on commercial entities  

## UI locations

| Surface | Path / location |
|---------|-----------------|
| Tenant Registry — Commercial tab | Super Admin → Tenant Registry → expand tenant → **Commercial** |
| Commercial Risk dashboard | Super Admin → **Commercial Risk** (`/super-admin/commercial-risk`) |
| Tenant billing (read-only) | Workspace → **Billing → Invoices** (`/billing/invoices`) |
| Platform Activity (global) | Super Admin → Platform Activity (platform-scoped events) |
| Tenant commercial activity | Commercial tab → **Commercial Activity** section |

Deep link from risk dashboard:  
`/super-admin/tenants?tenantId={id}&tab=commercial`

## Tenant visibility rules

- Tenants see only their workspace invoices (read-only).  
- Download requires `tenant.billing.invoiceDocuments.download`.  
- No upload, edit, pay, or delete on tenant side.  

## API overview (read vs write)

| API family | Methods |
|------------|---------|
| Commercial account/contacts/contracts/invoices/payments | GET + controlled PUT/PATCH (platform) |
| Commercial risk | GET only |
| Commercial activity (tenant) | GET only |
| Tenant billing | GET only |

## Limitations & future work

- No tenant-scoped export bundle or bulk operations in Phase 15  
- No email/notifications from commercial module  
- Platform Activity global feed excludes workspace-scoped rows by design; tenant commercial activity uses dedicated endpoint  
- Risk scores are computed per request, not historized in DB  

Phase 15 closes with **Commercial Administration** complete. Further product phases are out of scope for this document.
