# Phase One — Workforce Runtime Plan

**Program:** Enterprise Workforce Platform Refactor  
**Phase:** 1 — Workforce Canonicalization & HR Runtime Unification  
**Status:** Planning only — no code/schema changes in this document  
**Environment order:** Local dev → staging → production push

---

## 1. Current State (Discovery Summary)

From prior audits (`employee-model-audit.md`, `hr-foundation-model-audit.md`, `workforce-structure-full-audit-report.txt`):

| Layer | Canonical (intended) | Legacy (active) | Problem |
|-------|---------------------|-----------------|---------|
| Person | `employees` | `users` | Dual directories; optional link |
| Org | `hr_org_units` | `departments` + `user_departments` | Two trees; users vs employees |
| Manager | `employees.directManagerId` | `users.lineManagerId` | Leave vs workflows disagree |
| Job | `jobTitleId`, `jobGradeId` | `users.position`, `employees.position` text | Unstructured fallback |
| Position seat | `hr_positions` | — | Schema only; `positionId` unused |

**Runtime split today:**
- HCM routes (`hr.ts`, `leave.ts`) → employee model
- Workflows (`steps/approval.ts`) → user `lineManagerId`
- User admin (`users.tsx`) → legacy departments

---

## 2. Target State — Single Workforce Runtime

```
┌─────────────────────────────────────────────────────────┐
│           WORKFORCE RUNTIME (canonical)                  │
│  employees ──► orgUnitId ──► hr_org_units (tree)        │
│           ──► directManagerId (employee graph)           │
│           ──► jobTitleId / jobGradeId / positionId       │
│           ──► userId (optional login bridge)             │
└──────────────────────────┬──────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              │  Compatibility Layer     │
              │  (Phase 1 — temporary)   │
              │  sync users ↔ employees    │
              │  map departments → org     │
              └────────────┬──────────────┘
                           │
              Legacy consumers (unchanged API surface)
              users, departments, workflows (adapted reads)
```

**Principles:**
1. **`employees` = workforce source of truth** for org, manager, job, lifecycle
2. **`hr_org_units` = organizational source of truth** (departments become legacy read alias)
3. **`users` = identity/access only** — org/manager denormalized mirrors for backward compat during migration
4. **No breaking API removals in Phase 1**

---

## 3. Phase 1 Scope (In / Out)

### In scope
- Canonical mapping spec and migration scripts (idempotent)
- `WorkforceRuntimeService` — resolve employee, org path, manager chain
- Compatibility adapters: user create/update → optional employee sync; department CRUD → org unit mirror (optional flag)
- Manager resolution unification for **new** code paths; adapters for workflow/leave
- Data integrity validators (orphan detection, workspace reports)
- Foundation FK binding plan (status/employment/contract codes → enforced sync, Phase 1b if needed)

### Out of scope (later phases)
- Position seat occupancy engine (Phase 2)
- Workflow UX rebuild (Phase 3)
- Mandatory org/manager enforcement (Phase 4 hard gate)
- Legacy table drops (Phase 5)

---

## 4. Implementation Workstreams

### WS-1: Workforce Runtime Audit (complete — prior deliverables)
- Input: all `employee-*`, `organization-*`, `hr-foundation-*`, `workflow-*` audit docs
- Output: gap list in `canonical-workforce-mapping.md`

### WS-2: Canonical Data Mapping
- Map every legacy field → canonical field (see `canonical-workforce-mapping.md`)
- Define `workforce_sync_state` metadata column or side table for migration tracking (optional, Phase 1.1)

### WS-3: Legacy Dependency Mapping
- Inventory: grep + route audit for `departmentId`, `lineManagerId`, `departments`, `approvals`
- Document in `legacy-compatibility-plan.md`

### WS-4: Employee Runtime Refactor (incremental)
| Step | Change | Backward compat |
|------|--------|-----------------|
| 1.1 | Add `lib/workforce/` package: types + resolvers | None — new code |
| 1.2 | PATCH employee validates manager in workspace, same-workspace org | Stricter; warn only first |
| 1.3 | Link user ↔ employee sync hook (optional `syncProfileFields`) | Old link API unchanged |
| 1.4 | Employee detail UI: org/manager edit | API already supports PATCH |

### WS-5: Org Unit Runtime Refactor
| Step | Change | Backward compat |
|------|--------|-----------------|
| 2.1 | Org unit parent cycle detection (app layer) | Reject new cycles only |
| 2.2 | `GET /hr/org-units/tree` — nested JSON | Keep flat list endpoint |
| 2.3 | Department → org unit mapping table `legacy_department_org_map` | departments API unchanged |

### WS-6: Manager Runtime Resolution
| Step | Change | Backward compat |
|------|--------|-----------------|
| 3.1 | `resolveDirectManagerUserId(employeeId)` — canonical | Used by leave + new workflow adapter |
| 3.2 | `syncLineManagerFromEmployee(userId)` on link/sync | Writes `users.lineManagerId` from employee chain |
| 3.3 | Workflow approval step: try employee path first, fallback lineManagerId | No API change |

### WS-7: Legacy Compatibility Layer
- See `legacy-compatibility-plan.md`
- Feature flags per workspace: `workforceCanonicalMode: off | shadow | active`

### WS-8: Data Integrity Validation
- See `workforce-runtime-validation.md`
- CLI/script: `scripts/validate-workforce-integrity.cjs` (idempotent read-only checks)

---

## 5. Migration Strategy (Production-Safe)

### 5.1 Phased rollout flags (`hr_workspace_settings`)

```typescript
// Proposed columns (migration in Phase 1.1)
workforceCanonicalMode: 'legacy' | 'shadow' | 'active'
workforceSyncDirection: 'none' | 'employee_to_user' | 'bidirectional'
```

| Mode | Behavior |
|------|----------|
| `legacy` | Current behavior; adapters log only |
| `shadow` | Canonical resolver runs; compare to legacy; log mismatches |
| `active` | Writes go to canonical; compat layer syncs legacy fields |

### 5.2 Idempotent backfill migration (local + prod)

**Order:**
1. Ensure `hr_org_units` seeded per workspace (manual or script)
2. Backfill `legacy_department_org_map` from name match (departments → org units)
3. For each user with `departmentId`: if linked employee exists, set `orgUnitId` from map
4. For each employee with `directManagerId`: sync manager's `userId` → requester's chain validation
5. For linked user/employee pairs: sync `lineManagerId` from `directManagerId` → manager.userId

**Rules:**
- `ON CONFLICT DO NOTHING` / upsert by natural keys
- Never DELETE legacy rows in Phase 1
- Log unresolved rows to `workforce_migration_exceptions` table (append-only)

### 5.3 Schema changes (minimal, additive only)

| Change | Type | Safety |
|--------|------|--------|
| `hr_workspace_settings.workforce_*` flags | ADD columns nullable with defaults | Backward compat |
| `legacy_department_org_map` | NEW table | No impact on existing |
| `workforce_migration_exceptions` | NEW table | Audit only |
| FK on `directManagerId` | DEFER to Phase 2 | Avoid lock risk in Phase 1 |

---

## 6. API Compatibility Contract (Phase 1)

| Endpoint | Phase 1 guarantee |
|----------|-------------------|
| `GET/POST/PATCH /users` | Unchanged response shape; may add optional `employeeId` enrichment |
| `GET/POST /departments` | Unchanged; optional `orgUnitId` in response when mapped |
| `POST /hr/employees` | Unchanged; optional warnings in body |
| `PATCH /hr/employees/:id` | Unchanged |
| `POST /workflows/.../approve` | Unchanged |
| `POST /hr/me/leave-requests` | Unchanged; internal resolver may change in `active` mode |

---

## 7. Local → Production Deployment Sequence

1. **Local:** Apply additive migrations; run backfill script with `DATABASE_URL`
2. **Local:** Set one workspace to `shadow`; run validation script
3. **Local:** Fix mapping exceptions; set `active` on pilot workspace
4. **Staging:** Same migrations + backfill + validation gate in CI
5. **Production:** Migrations auto-run on deploy; backfill as **manual job** (ops runbook); default `workforceCanonicalMode=legacy` globally
6. **Production:** Enable `shadow` per tenant; then `active` per tenant after sign-off

**Fail-safe:** Deploy script checks required columns exist; API returns 503 with clear message if migration not applied (pattern from commercial hotfix).

---

## 8. Timeline Estimate (engineering)

| Milestone | Duration |
|-----------|----------|
| Package + adapters + flags | 2–3 weeks |
| Mapping tables + backfill script | 1 week |
| Shadow mode + validation | 1 week |
| UI employee org edit + admin docs | 1 week |
| Pilot tenant + prod runbook | 1 week |

**Total Phase 1:** ~6–8 weeks with testing

---

## 9. Success Criteria

- [ ] Single resolver used by leave and workflow (with legacy fallback)
- [ ] Zero API breaking changes in contract tests
- [ ] Backfill idempotent — safe to re-run
- [ ] Shadow mode report: &lt;5% manager/org mismatch after remediation
- [ ] No orphan `directManagerId` pointing outside workspace (validated)
- [ ] Production deploy: migrations + health check pass

---

## 10. References

- `canonical-workforce-mapping.md`
- `legacy-compatibility-plan.md`
- `workforce-runtime-validation.md`
- Prior audits: `employee-model-audit.md`, `workflow-org-dependency-analysis.md`

---

*End of Phase One — Workforce Runtime Plan.*
