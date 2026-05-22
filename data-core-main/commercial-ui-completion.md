# Commercial UI Completion

## CommercialConsole

- Loads commercial account when **any** of: account, contacts, contracts, invoices visible
- Passes `canUpload` to contracts panel
- Sections: account → contracts → invoices (no accordion placeholders)

## OperationalContractsPanel

- Self-fetches account if parent did not pass `commercialAccountId`
- Primary **Add contract record** button
- Full form: number, title, company, responsible person, phone, email, dates, notes
- Row: dates grid, reminder badge, `CommercialPdfActions`, edit
- Banner when commercial account missing

## OperationalInvoicesPanel

- Same account fallback
- Timeline with contract link, contact, reminder, upload metadata
- `CommercialPdfActions` on each row
- **Add invoice record** button with test id

## No orphan / hidden flows

| Removed / avoided | Replacement |
|-------------------|-------------|
| Text-only upload links | `CommercialPdfActions` buttons |
| Upload only after obscure edit | Post-create file picker + row buttons |
| Account id only from accounts.read | Shared account query |
| ERP fields | Not rendered |

## Permissions

| Action | Permission |
|--------|------------|
| View contracts/invoices | `*.read` |
| Create/edit metadata | `*.update` |
| Upload contract PDF | `contracts.update` or `invoiceDocuments.upload` |
| Upload invoice PDF | `invoiceDocuments.upload` |
| Download PDF | `contracts.read` / `invoiceDocuments.read` |
