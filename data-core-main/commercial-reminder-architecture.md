# Commercial Reminder Architecture

## Audience

**Platform super-admin / operations only.** No customer emails, no auto-charge, no workspace suspension from commercial reminders.

## Derivation (`commercial-operational.ts`)

Reminders computed at read time from ISO dates (`YYYY-MM-DD`) vs UTC "today".

| Urgency | Condition (days until date) |
|---------|----------------------------|
| `overdue` | &lt; 0 |
| `due` | 0–7 |
| `upcoming` | 8–30 |
| `none` | &gt; 30 (omitted from list) |

`pickPrimaryReminder` chooses highest severity among active reminders.

## Contract reminders

| Code | Label | Source field |
|------|-------|--------------|
| `contract_end` | Contract ending | `contractEndDate` |
| `renewal` | Renewal reminder | `renewalDate` (renewal reminder date) |

## Invoice reminders

| Code | Label | Source field |
|------|-------|--------------|
| `invoice_reminder` | Payment / invoice reminder | `reminderDate` |

(Migrated from legacy `due_date` where present.)

## UI presentation

- Badge on each contract row and invoice timeline item (`primaryReminder`).
- Copy is operational ("Contract ending", "Renewal reminder") not accounting ("Overdue AR").

## Future extensions (not in this phase)

1. **Missing invoice** — platform job comparing subscription renewal vs latest invoice PDF.
2. **Workspace renewal** — cross-link `workspace_subscriptions.renewalDate` in commercial overview.
3. **Aggregated dashboard** — `/super-admin/commercial-risk` feed from reminder DTOs (read-only).

## Platform risk page

`/super-admin/commercial-risk` remains a **separate** cross-tenant view; per-tenant commercial tab does not duplicate full risk analytics.

## API shape

```json
{
  "primaryReminder": {
    "code": "contract_end",
    "label": "Contract ending",
    "urgency": "due",
    "relatedDate": "2026-05-20"
  },
  "reminders": [ ... ]
}
```

No persisted reminder state — avoids stale alert tables and duplicate scheduling systems.
