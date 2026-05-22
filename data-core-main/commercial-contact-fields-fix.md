# Commercial Contact Fields Fix

## Standard labels (all surfaces)

| Label | DB / API field |
|-------|----------------|
| Responsible person name | `responsiblePersonName` / `contractOwnerName` / `contactName` |
| Phone number | `responsiblePersonPhone` / `billingPhone` / `contactPhone` |
| Email address | `responsiblePersonEmail` / `contractOwnerEmail` + `billingEmail` / `contactEmail` |

## Commercial account

- **Display:** responsible person, phone, email on account card
- **Edit form:** legal entity, responsible person name, phone, email (maps to `contractOwnerName`, `billingPhone`, `contractOwnerEmail` + `billingEmail`)

## Billing contacts

- Form now includes **phone number** (was missing from UI)
- Labels aligned to responsible-person naming

## Contracts

- API: `responsiblePersonName`, `responsiblePersonPhone`, `responsiblePersonEmail` on `commercial_contract_terms`
- UI form + timeline card contact column
- Payload sanitized via `sanitizeOperationalPayload` (empty strings omitted)

## Invoices

- API: same three fields + `reminderDate`
- UI form + timeline contact block
- `reminderDate` uses `parseOptionalDate` (no INVALID sent to DB)

## Migration backfill (existing rows)

```sql
responsible_person_name ← customer_decision_maker_name
responsible_person_email ← customer_decision_maker_email
reminder_date ← due_date (invoices)
```
