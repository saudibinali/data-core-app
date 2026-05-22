# Commercial UI Rebuild

## Entry point

`/super-admin/tenants` → expand tenant → **Commercial** tab → `CommercialConsole`.

## Layout (post-refactor)

```
┌─────────────────────────────────────────────┐
│ Info banner — operational tracking only     │
├─────────────────────────────────────────────┤
│ Commercial account (existing section)       │
├─────────────────────────────────────────────┤
│ OperationalContractsPanel                   │
│  • list + reminder badges                   │
│  • download / upload PDF                    │
│  • add / edit simplified form               │
├─────────────────────────────────────────────┤
│ OperationalInvoicesPanel                    │
│  • timeline                                 │
│  • contract link + reminder date              │
│  • download / upload PDF                      │
└─────────────────────────────────────────────┘
```

## Removed from commercial tab

- Accordion overview / risk / collection sections
- `ContractTermsSection` ERP form (currency, value, billing cycle, change status)
- `InvoicesSection` + inline `CollectionTrackingPanel`
- Payment record / verify / reverse actions
- Props: `canReadPayments`, `canRecordPayments`, `canVerifyPayments`, `canReadRisk`, `canReadActivity`

## Permission matrix (unchanged codes)

| Permission | Contracts | Invoices | PDF upload |
|------------|-----------|----------|------------|
| `commercial.contracts.read` | View | — | — |
| `commercial.contracts.update` | Create/edit | — | — |
| `commercial.invoices.read` | — | View | — |
| `commercial.invoices.update` | — | Create/edit | — |
| `commercial.invoiceDocuments.upload` | — | — | Upload |

## Test IDs

- `commercial-console`
- `commercial-console-section-contracts`
- `commercial-console-section-invoices`
- `operational-contracts-panel`
- `operational-invoices-panel`
- `operational-contract-row-{id}` / `operational-invoice-row-{id}`

## Legacy components

Still in repo for reference / gradual deletion:

- `ContractTermsSection.tsx`
- `InvoicesSection.tsx`
- `CollectionTrackingPanel.tsx`
- `CommercialCollectionSection.tsx`

Not imported by `CommercialConsole` after simplification.

## Target UX checklist

- [x] Contract list shows dates + alert + contact + PDF actions
- [x] Invoice timeline shows number + contact + contract + reminder
- [x] Upload is primary action after create
- [x] No accounting field labels in forms
