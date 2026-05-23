# Migration Safety Verification

**Phase:** All phases — Idempotent migration governance

---

## 1. Migration Principles

1. **Idempotent** — safe to run multiple times
2. **Additive first** — ADD columns/tables before code depends on them
3. **Dual-write before cutover** — never read-new/write-old without overlap period
4. **Explicit backfill** — heavy data moves as scripts with progress logs
5. **Fail-safe deploy** — API detects missing schema → 503 with action message
6. **Reversible** — archive before DROP; flag rollback before code rollback

---

## 2. Migration File Ownership

| Location | Owner |
|----------|-------|
| `lib/db/drizzle/*.sql` | Canonical schema migrations |
| `scripts/migrate-*.cjs` | Data backfill (commercial pattern) |
| `scripts/validate-*.cjs` | Post-migration gates |

**Forbidden:** manual prod SQL not in repo; tables outside drizzle system.

---

## 3. Idempotent Patterns

### Add column
```sql
ALTER TABLE hr_workspace_settings
  ADD COLUMN IF NOT EXISTS workforce_canonical_mode text DEFAULT 'legacy';
```

### Create table
```sql
CREATE TABLE IF NOT EXISTS legacy_department_org_map (...);
```

### Backfill
```sql
INSERT INTO legacy_department_org_map (...)
SELECT ... WHERE NOT EXISTS (SELECT 1 FROM legacy_department_org_map m WHERE ...);
```

### Seed
Use `onConflictDoNothing()` (existing pattern in foundation seed).

---

## 4. Phase Migration Registry

| Phase | Migration ID | Description |
|-------|--------------|-------------|
| 1 | `00XX_workforce_canonical_flags` | workspace flags + map table |
| 1 | script: `migrate-workforce-backfill.cjs` | dept map, manager sync |
| 2 | `00XX_position_hierarchy` | reports_to, org manager |
| 2 | script: `migrate-position-suggest.cjs` | suggest assignments |
| 3 | `00XX_approval_unified` | approval_instances/steps |
| 4 | `00XX_workforce_timeline` | timeline + audit |
| 5 | `00XX_drop_legacy_*` | only after validation |

---

## 5. Local Development Workflow

```bash
pnpm --filter @workspace/db run push   # or migrate
node scripts/migrate-workforce-backfill.cjs
node scripts/validate-workforce-integrity.cjs
pnpm --filter api-server dev
```

---

## 6. Production Workflow

```bash
# Deploy applies migrations automatically
# Ops runs (once per env):
node scripts/migrate-workforce-backfill.cjs
node scripts/validate-workforce-integrity.cjs
# Enable shadow → active per tenant via admin API
```

---

## 7. Verification Checklist (each release)

- [ ] Migration applied: `\d hr_workspace_settings` shows new columns
- [ ] No orphan relations from new FKs
- [ ] Backfill exception count documented
- [ ] API health `/health` OK
- [ ] Integrity script ERROR count = 0
- [ ] Rollback procedure tested in staging

---

## 8. Schema Drift Prevention

- CI job: `validate-schema-drift.cjs` on every PR touching `lib/db`
- Production boot: lightweight column probe (pattern from commercial 503 guard)

---

## 9. Compatibility Window Timeline (example)

| Week | Phase 1 | Phase 2 | Phase 3 |
|------|---------|---------|---------|
| 1-2 | legacy | — | — |
| 3-4 | shadow | dev | — |
| 5-6 | active pilot | shadow | dev |
| 7+ | active all | active | dual-write |

Legacy cleanup (Phase 5) only after **all** active tenants stable 30+ days.

---

*End of Migration Safety Verification.*
