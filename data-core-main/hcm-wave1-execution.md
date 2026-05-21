# HCM Wave 1 — Execution Checklist

**Target:** Integrated HCM nucleus — payroll-scoped finance only.

## Code (this sprint)

- [x] Product spec `hcm-integrated-platform-spec.md`
- [x] HCM module catalog: `payroll`, `attendance` modules in seed
- [x] Module dependencies: HCM-first graph
- [x] HR workflow templates: leave, payroll review, offboarding notify
- [x] Workforce report: `hr.leave.requests`
- [x] RBAC catalog: payroll + self-service + attendance permissions
- [x] ESS quick links (payslips, leave, attendance) — verified
- [x] HR dashboard integrated nav (dedupe payroll ops)
- [x] Smoke: `p-hcm-wave1.smoke.test.ts`

## Operations (your team)

- [ ] Backup DB
- [ ] Run migration `0022_hcm_drop_erp_domains.sql` on non-prod
- [ ] Pilot tenant: enable `hr` → `payroll` → `attendance` → `self-service`
- [ ] Execute leave + payroll migration via `/admin/platform/stabilization`
- [ ] Set `LEGACY_LEAVE_FREEZE` / `LEGACY_PAYROLL_FREEZE` in production when ready

## W2+ (not started)

- ATS / recruiting module
- Performance management
- LMS
- Succession planning
