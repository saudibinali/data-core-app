# Runbook — Deploy (Manual)

**الفيز:** F0.4 | **النطاق:** CI + migrations + smoke | **Deploy:** يدوي (لا CD تلقائي)

---

## 1. متى تُنفَّذ

- بعد merge على `main`/`master` عندما يكون **CI أخضر**
- نافذة صيانة معتمدة (إن لزم)
- **لا نشر على VPS** قبل اجتياز checklist أدناه

---

## 2. Checklist قبل النشر

| # | البند | الأمر / المرجع |
|---|--------|----------------|
| 1 | Journal = SQL | `pnpm run validate:migration-journal` |
| 2 | اختبارات unit (بدون DB) | `pnpm test` |
| 3 | Typecheck مكتبات | `pnpm run typecheck:libs` |
| 4 | Build API | `pnpm --filter @workspace/api-server run build` |
| 5 | Build Web (إن نُشر UI) | `pnpm --filter @workspace/ops-platform run build` |
| 6 | **نسخة احتياطية DB** | `pnpm run db:backup` |
| 7 | **JWT_SECRET قوي** (≥32 حرف، ليس القيمة الافتراضية) | `.env` / `openssl rand -hex 64` |
| 8 | **CORS origins** | Platform Settings → Network → `cors_origins` + `APP_URL` |
| 9 | GitHub Actions | job `validate` + `database-integrity` ✅ |

> **مرجع:** [runtime-integrity-validation.md](../../runtime-integrity-validation.md) — بوابات pre/post deploy  
> **إعداد أول:** [platform-overview.txt §15](../../platform-overview.txt) — wizard `/setup/database`

---

## 3. نشر Docker (موصى به للإنتاج)

```bash
cd data-core-main
cp .env.example .env
# عدّل: JWT_SECRET (required, no default), POSTGRES_PASSWORD, APP_URL, DATABASE_URL (إن خارج compose)

# نسخة احتياطية (إن DB موجودة)
DATABASE_URL=postgresql://... pnpm run db:backup

# migrations additive
DATABASE_URL=postgresql://... pnpm run db:migrate

# بناء وتشغيل
docker compose -f deploy/docker-compose.yml build
docker compose -f deploy/docker-compose.yml up -d
```

---

## 4. نشر Bare Metal (VPS — PM2)

```bash
cd data-core-main
pnpm install --frozen-lockfile

# DB
DATABASE_URL=... pnpm run db:backup
DATABASE_URL=... pnpm run db:migrate

# Build (إلزامي بعد أي تغيير API — خاصة provisioning routes)
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/ops-platform run build

# Restart
pm2 restart deploy/ecosystem.config.cjs --update-env
# أو أول مرة:
# pm2 start deploy/ecosystem.config.cjs --env-file .env
```

---

## 5. Post-deploy smoke (F0.3)

```bash
DATABASE_URL=... pnpm run test:smoke
```

يشمل: journal → migrate → workforce integrity → production smoke (auth, HR CRUD, tenant isolation).

**هدف زمني:** &lt; 5 دقائق.

---

## 6. تحقق سريع بعد النشر

```bash
# صحة API
curl -sf http://localhost:8080/api/health || curl -sf http://YOUR_HOST/api/health

# workforce + payroll canonical integrity (read-only)
DATABASE_URL=... pnpm run validate:workforce
DATABASE_URL=... pnpm run validate:payroll
# أو معاً (F6.4):
DATABASE_URL=... pnpm run validate:canonical-cutover
```

---

## 7. Rollback

راجع [rollback.md](./rollback.md).  
فشل migration → [incident-db-migration-failed.md](./incident-db-migration-failed.md).

---

## 8. قيود F0 (بدون تعطيل)

- **لا** تغيير سلوك المستخدم عمداً في F0
- **لا** CD تلقائي — CI فقط
- migrations **additive**؛ backup قبل `db:migrate`

---

*آخر تحديث: F0.4 — مايو 2026*
