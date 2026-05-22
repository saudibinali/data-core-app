# Commercial Upload Runtime Fix

## Backend

| Endpoint | Permission | Behavior |
|----------|------------|----------|
| `POST .../commercial-contracts/:id/document` | `commercial.contracts.update` | Multipart PDF via `parseContractPdfUpload` |
| `GET .../commercial-contracts/:id/document` | `commercial.contracts.read` | Stream download |
| `POST .../commercial-invoices/:id/document` | `commercial.invoiceDocuments.upload` | Multipart PDF |
| `GET .../commercial-invoices/:id/document` | `commercial.invoiceDocuments.read` | Stream download |

Replace flow: deletes prior storage key when document row exists, updates metadata.

## Frontend

### `CommercialPdfActions.tsx`

Shared visible controls:

- **Upload PDF** (primary when missing)
- **Replace PDF** (outline when present)
- **Download PDF**
- **Missing PDF** indicator (`data-testid="commercial-pdf-missing-indicator"`)

### Wiring

- `OperationalContractsPanel` — `CommercialPdfActions` on every row; hidden file input; auto-prompt upload after successful create when `canUpload`
- `OperationalInvoicesPanel` — same pattern
- `CommercialConsole` — `canUploadContracts = canWriteContracts || canUploadDocuments` so finance users with document upload permission can upload contract PDFs

### Hooks

- `useUploadCommercialContractDocument` — `FormData` POST (no JSON Content-Type)
- `useDownloadCommercialContractDocument` — blob download
- Invoice hooks unchanged; error messages include API `detail` when schema mismatch

## Operator flow

1. Add contract / invoice record → Save  
2. File picker opens automatically (if upload allowed)  
3. Or use **Upload PDF** on the row anytime  
4. **Missing PDF** badge until uploaded  
