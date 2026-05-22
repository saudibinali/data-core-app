# Subscription DB Validation

## Expected table

`workspace_subscriptions` (see `lib/db/src/schema/workspace-subscriptions.ts` and `scripts/apply-p16-tables.cjs`).

## Column compatibility

| Column | Type | Insert when omitted |
|--------|------|---------------------|
| `start_date`, `end_date`, `renewal_date` | `date` | `NULL` |
| `commercial_account_id`, `active_contract_term_id` | `integer` nullable | `NULL` |
| `grace_period_ends_at` | `timestamptz` | `NULL` |
| `subscription_code`, `subscription_name`, `status` | required | always set |

**Bug state:** sent `"MISSING"` into date/integer columns → 500.

**Fixed state:** sends SQL `NULL`.

## FK rules

- `commercial_account_id` → `commercial_accounts.id` (nullable, `ON DELETE SET NULL`)
- `active_contract_term_id` → `commercial_contract_terms.id` (nullable)
- Validation ensures IDs belong to the same `workspace_id` when non-null

## Migration / cleanup

- `scripts/migrate-canonical-subscription.cjs` — copies legacy P13 rows; unrelated to this 500
- `scripts/drop-legacy-subscription-tables.sql` — do **not** run until migrations verified; does not drop `workspace_subscriptions`

## Quick SQL checks

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'workspace_subscriptions'
ORDER BY ordinal_position;

SELECT COUNT(*) FROM workspace_subscriptions;
```

If the table is missing, apply `scripts/apply-p16-tables.cjs` or your Drizzle migration — that produces a clear error, not the MISSING sentinel issue.
