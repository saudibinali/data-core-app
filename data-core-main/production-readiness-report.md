# Production Readiness Report (Template)

**Phase:** 5 — Enterprise platform go-live checklist  
**Environment:** Local validated → Staging → Production

---

## 1. Platform Readiness Scorecard

| Dimension | Target | Verification |
|-----------|--------|--------------|
| Workforce canonical | All prod tenants `active` | workspace settings audit |
| Org graph | Tree API + positions wired | E2E org tests |
| Approvals | Unified runtime only | No dual-write |
| Employee file | Mandatory gate enforced | Sample audit 100 employees |
| Legacy traffic | 0 on deprecated APIs | 30-day logs |
| Migrations | Idempotent, automated | CI + prod run log |
| Rollback | Tested in staging | Runbook dated |
| Monitoring | Alerts on compat failures | Dashboard links |
| Documentation | Ops runbooks complete | Link |

---

## 2. Deployment Pipeline

```
1. Build api-server + ops-platform
2. Run migrations (fail-fast on error)
3. Schema drift check
4. Integrity validation (warn → block if configured)
5. Rolling restart
6. Post-deploy smoke
7. Optional: backfill job (manual trigger)
```

**Never:** skip migration step; never `--force` drop.

---

## 3. Production Runbooks Required

| Runbook | Owner |
|---------|-------|
| workforce-backfill.md | Ops |
| workforce-flag-rollback.md | Ops |
| approval-sla-worker-restart.md | Ops |
| integrity-validation-weekly.md | Ops |
| incident-workforce-sync-failure.md | SRE |

---

## 4. Monitoring & Alerts

| Metric | Alert threshold |
|--------|-----------------|
| `workforce.compat.sync_failed` | &gt;10/hour |
| `approval.sla.overdue` | &gt;50 pending |
| `integrity.validation.errors` | &gt;0 on scheduled run |
| API 503 schema mismatch | any |

---

## 5. Data Backup

- Pre-major-release: full DB snapshot
- Archive legacy tables before DROP
- Point-in-time recovery tested quarterly

---

## 6. Multi-Tenant Rollout

1. Pilot tenant (internal)
2. 10% tenants (low complexity)
3. 50% tenants
4. 100% + legacy cleanup phase 5.2+

Rollback per tenant via `workforceCanonicalMode=legacy` until Phase 5 complete.

---

## 7. Enterprise Capability Checklist

- [ ] Organizationally intelligent routing
- [ ] Runtime-governed employee file
- [ ] Approval-aware with delegation
- [ ] Workflow-native embedded processes
- [ ] Production-safe migrations
- [ ] Globally scalable read models (cache optional)

---

## 8. Known Limitations (post-launch)

Document honestly:
- Matrix org Phase 2.5 if not complete
- Payroll canonical separate track
- Finance/SCM modules independent

---

*End of Production Readiness Report template.*
