# Runtime Integrity Validation

**Phase:** 5 — Final enterprise validation suite

---

## 1. Validation Categories

| Category | Scripts / tests |
|----------|-----------------|
| Schema consistency | Drizzle schema vs DB introspection |
| Workforce graph | validate-workforce-integrity.cjs (full) |
| Position occupancy | occupancy = count(employees) |
| Approval consistency | no pending without approver |
| Leave balances | sum matches policy accrual rules |
| Orphan FKs | all employee FKs resolve |
| Legacy zero-traffic | access logs on deprecated routes |
| API contracts | OpenAPI snapshot tests |

---

## 2. Automated Gate (CI/CD)

**Pre-deploy (staging):**
```
pnpm run migrate
node scripts/validate-workforce-integrity.cjs --fail-on-warn
pnpm --filter api-server test
pnpm --filter ops-platform test
node scripts/validate-schema-drift.cjs
```

**Post-deploy (production smoke):**
```
curl /health/workforce
node scripts/validate-workforce-integrity.cjs --read-only --workspace=all
```

---

## 3. Schema Drift Detection

`scripts/validate-schema-drift.cjs`:
- Compare `@workspace/db` expected columns vs `information_schema`
- Fail if migration not applied
- Fail if extra unmanaged columns (configurable allowlist)

---

## 4. Orphan Detection Queries

| Query | Expected |
|-------|----------|
| employees without workspace | 0 |
| org_unit parent in other workspace | 0 |
| positionId pointing to deleted position | 0 |
| approval_steps pending with inactive approver | 0 |
| timeline events without employee | 0 |

---

## 5. Performance Baselines

| Operation | p95 target |
|-----------|------------|
| getReportingChain | &lt;50ms |
| org subtree employees | &lt;200ms |
| approval inbox | &lt;100ms |
| employee file aggregate | &lt;300ms |

Load test before prod hardening sign-off.

---

## 6. Security Validation

- Approver cannot approve own request (except configured exec override)
- Cross-workspace IDOR attempts fail
- Delegation scope enforced
- Audit log tamper-evident (append-only grants)

---

## 7. Sign-Off Template

| Role | Sign-off |
|------|----------|
| Engineering lead | Runtime integrity PASS |
| QA | E2E suite PASS |
| Ops | Migrations + rollback tested |
| Product | UX acceptance |
| Security | IDOR + auth review |

---

*End of Runtime Integrity Validation.*
