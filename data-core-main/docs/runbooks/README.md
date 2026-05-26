# Ops Runbooks (F0.4)

| Runbook | الغرض |
|---------|--------|
| [deploy.md](./deploy.md) | نشر يدوي — Docker / PM2 + smoke |
| [rollback.md](./rollback.md) | تراجع تطبيق أو DB |
| [incident-db-migration-failed.md](./incident-db-migration-failed.md) | حادث فشل migration |

**مراجع إضافية:**

- [platform-overview.txt §15](../../platform-overview.txt) — الإعداد الأول  
- [runtime-integrity-validation.md](../../runtime-integrity-validation.md) — بوابات الجودة  

**سكربتات F0:**

```bash
pnpm run validate:migration-journal
pnpm run db:backup
pnpm run db:migrate
pnpm run validate:workforce
pnpm run test:smoke
```
