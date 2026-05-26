# Incident — Database Migration Failed

**الفيز:** F0.2/F0.4 | **الخطورة:** Critical | **الاستجابة:** فورية

---

## 1. الأعراض

- `pnpm run db:migrate` يرجع `ok: false`
- API لا يبدأ / `runMigrations()` يفشل عند boot
- `validate:migration-journal` ✅ لكن apply يفشل على prod/staging
- CI job `database-integrity` أحمر على migrate step

---

## 2. إجراءات فورية (5 دقائق)

```bash
# 1) أوقف كتابة التطبيق
docker compose -f deploy/docker-compose.yml stop api
# أو: pm2 stop <api-process>

# 2) لا تعِد migrate blindly
# 3) احفظ السجل
pnpm run db:migrate 2>&1 | tee migration-failure.log

# 4) تحقق من journal drift
pnpm run validate:migration-journal
```

---

## 3. تشخيص

| الفحص | الأمر |
|--------|--------|
| آخر migration مُطبَّق | `SELECT * FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 5;` |
| journal vs disk | `pnpm run validate:migration-journal` |
| جداول ناقصة | `\dt` / `information_schema.tables` |
| workforce schema | `node scripts/validate-workforce-integrity.cjs` (قد يفشل — متوقع) |

**أسباب شائعة (F0):**

- journal drift (SQL بدون إدخال) — يُصلَح في repo ثم redeploy  
- DB أُنشئت بـ `push` بدون history — baseline عبر `migrate.ts` / `fix-migration-baseline.mjs`  
- migration غير additive (DROP/ALTER destructive) — **يتطلب restore**  
- FK يعتمد جدولاً لم يُنشأ (مثل `workflow_approvals`) — أصلح في repo (additive prerequisite)

---

## 4. مسارات الاست recovery

### A) فشل قبل commit transaction (الأفضل)

- Drizzle migrator transactional per file — غالباً لا partial apply  
- أصلح SQL/journal في repo → backup → `db:migrate` من جديد

### B) partial apply / schema مختلط

```bash
DATABASE_URL=... pnpm run db:backup
# restore إلى backup pre-migrate
psql $DATABASE_URL -f backups/pre-migrate-YYYY-MM-DD.sql
# rollback app إلى SHA متوافق
```

### C) بيئة push-only (لا `__drizzle_migrations`)

```bash
node scripts/fix-migration-baseline.mjs   # يتطلب DATABASE_URL في .env
# ثم
pnpm run db:migrate
```

> **تحذير:** baseline يُعلِّم migrations كـ applied — استخدم فقط إذا schema فعلاً يطابق الملفات.

---

## 5. إصلاح في repo (بعد stabilize prod)

1. migration **additive** جديد (لا تعديل hash لملف مُطبَّق على prod)  
2. `pnpm run validate:migration-journal`  
3. CI `database-integrity` أخضر  
4. staging: backup → migrate → `test:smoke`  
5. prod: نفس [deploy.md](./deploy.md)

---

## 6. Checklist إغلاق الحادث

- [ ] خدمة API تعمل + `/api/health`  
- [ ] `validate:workforce` exit 0  
- [ ] `test:smoke` exit 0 (staging على الأقل)  
- [ ] RCA: سبب + prevention (journal gate, backup policy)  
- [ ] تحديث runbook إن لزم

---

## 7. أوامر مرجعية (F0)

```bash
pnpm run db:backup
pnpm run db:migrate
pnpm run validate:migration-journal
pnpm run validate:workforce
pnpm run test:smoke
```

---

## 8. Escalation

- فقدان بيانات محتمل → **restore backup** قبل أي migrate إضافي  
- drift بين 3+ envs → تجميد deploy حتى F0.2 reconciliation كامل  
- مرجع معماري: [runtime-integrity-validation.md](../../runtime-integrity-validation.md)

---

*Rollback عام:* [rollback.md](./rollback.md)
