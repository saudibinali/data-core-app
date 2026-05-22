# Commercial Runtime Validation

## Automated

| Suite | Command | Status |
|-------|---------|--------|
| Contract API | `vitest commercial-contracts.test.ts` | 25 tests |
| Invoice API | `vitest commercial-invoices.test.ts` | included |
| UI static | `commercial-tab-*`, `commercial-console-integration` | pass |

## Manual E2E checklist

1. **Migration** — `node scripts/migrate-commercial-simplification.cjs` with `DATABASE_URL`
2. **Commercial account** — set responsible person, phone, email; save
3. **Billing contact** — add contact with phone; appears in list
4. **Create contract** — title + contact only → **201** (not 500)
5. **Upload contract PDF** — row shows Download; Missing PDF cleared
6. **Download contract PDF** — file saves
7. **Second contract** — first remains in list
8. **Create invoice** — number + link contract + reminder
9. **Upload invoice PDF** — timeline shows uploaded timestamp
10. **Reminder badges** — set end/renewal/reminder dates in near future; badge visible

## Error expectations

| Case | HTTP | Body |
|------|------|------|
| Invalid email | 400 | `Invalid responsiblePersonEmail` |
| Bad date format | 400 | `Dates must be YYYY-MM-DD` |
| No commercial account | 404 | create account first |
| Schema not migrated | 503 | run migration script + `detail` |
| Status workflow | 410 | workflow removed message |

## Log line for ops

On unhandled insert failures (non-schema):

```
[commercial-contracts POST] <stack in server log>
```

Schema mismatch is handled without generic swallow — returns 503 JSON, logs full error once.
