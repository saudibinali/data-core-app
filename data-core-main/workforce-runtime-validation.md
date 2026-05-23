# Workforce Runtime Validation

**Phase:** 1 — Validation & integrity gates (local + CI + pre-prod)

---

## 1. Validation Layers

| Layer | When | Fail action |
|-------|------|-------------|
| **L1 Schema** | Deploy boot | 503 if missing columns/tables |
| **L2 Data integrity** | Post-migration script | Exit code 1; no auto active mode |
| **L3 Shadow diff** | Scheduled / on-demand | Report only |
| **L4 API contract** | CI | Block merge |
| **L5 E2E smoke** | Staging | Block prod promote |

---

## 2. Script: `scripts/validate-workforce-integrity.cjs`

**Idempotent, read-only.** Requires `DATABASE_URL`.

### Checks

| ID | Check | SQL concept | Severity |
|----|-------|-------------|----------|
| W1 | Employee manager not self | `direct_manager_id = id` | ERROR |
| W2 | Manager in same workspace | join employees | ERROR |
| W3 | Org unit in same workspace | join hr_org_units | ERROR |
| W4 | Orphan directManagerId | left join null | WARN |
| W5 | Linked user same workspace | join users | ERROR |
| W6 | Duplicate employeeNumber per workspace | group by | ERROR |
| W7 | Duplicate userId on employees | unique | ERROR |
| W8 | Org parent cycle | recursive CTE | ERROR |
| W9 | Department map coverage | departments without map | WARN |
| W10 | lineManagerId vs canonical diff | shadow compare | INFO |
| W11 | positionId set but invalid FK | rare | WARN |
| W12 | leave approver unreachable | manager without userId | WARN |

### Output

```json
{
  "workspaceId": 1,
  "timestamp": "...",
  "errors": [],
  "warnings": [],
  "summary": { "employees": 120, "mappedDepartments": 8, "exceptions": 2 }
}
```

---

## 3. Shadow Mode Diff Report

**When `workforceCanonicalMode=shadow`**, log each:

| Event | Fields |
|-------|--------|
| `MANAGER_MISMATCH` | employeeId, directManagerUserId, lineManagerId |
| `ORG_MISMATCH` | employee.orgUnitId, mapped from user.departmentId |
| `TITLE_MISMATCH` | jobTitle vs user.position |

**Weekly admin email / dashboard (Phase 1.3 optional).**

---

## 4. CI Integration

```yaml
# Proposed job (conceptual)
- run: node scripts/validate-workforce-integrity.cjs
  env: DATABASE_URL: ${{ test_db }}
- run: pnpm --filter api-server test workforce-canonical
```

**New tests:**
- `workforce-resolver.test.ts`
- `legacy-adapter-shadow.test.ts`
- Extend `leave-canonical.smoke.test.ts` with canonical manager path

---

## 5. Pre-Production Gate Checklist

Before setting workspace to `active`:

- [ ] W1–W9 zero ERRORs for that workspace
- [ ] W12 warnings remediated or accepted in writing
- [ ] Shadow mode run ≥7 days with &lt;1% MANAGER_MISMATCH
- [ ] Leave pilot: 10 requests approved via canonical path
- [ ] Workflow pilot: 10 approvals via canonical path
- [ ] Rollback flag tested in staging

---

## 6. Post-Deploy Production Verification

1. Health: `GET /health` + schema version probe
2. Run integrity script read-only against prod (ops)
3. Sample 20 employees: manual spot-check org/manager in UI
4. Monitor error logs for `WorkforceCompat` failures 24h

---

## 7. Runtime Stability During Migration

| Risk | Mitigation |
|------|------------|
| Partial migration | L1 blocks boot if columns missing |
| Sync loop | Debounce bidirectional sync; employee wins |
| Performance | Index on employees(userId), org_units(parentId) — verify exist |
| Stuck leave approvals | Resolver fallback to admin unchanged |

---

*End of Workforce Runtime Validation.*
