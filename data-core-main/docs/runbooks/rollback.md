# Runbook — Rollback (Manual)

**الفيز:** F0.4 | **الهدف:** استعادة خدمة آمنة بعد نشر فاشل **بدون** فقدان بيانات غير مقصود

---

## 1. قرار Rollback

| السينario | الإجراء |
|-----------|---------|
| فشل build / restart فقط | rollback تطبيق (§2) — **لا** rollback DB |
| فشل migration أثناء apply | توقف فوري → [incident-db-migration-failed.md](./incident-db-migration-failed.md) |
| smoke / workforce integrity فاشل | rollback تطبيق + تحقق DB (§3) |
| تغيير بيانات خاطئ | restore من backup (§4) |

---

## 2. Rollback التطبيق (API + Web)

### Docker

```bash
cd data-core-main

# ارجع إلى commit/tag معروف جيداً
git checkout <PREVIOUS_TAG_OR_SHA>

docker compose -f deploy/docker-compose.yml build
docker compose -f deploy/docker-compose.yml up -d
```

### PM2 / Bare Metal

```bash
cd data-core-main
git checkout <PREVIOUS_TAG_OR_SHA>

pnpm install --frozen-lockfile
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/ops-platform run build

pm2 restart deploy/ecosystem.config.cjs --update-env
```

### تحقق

```bash
curl -sf http://localhost:8080/api/health
DATABASE_URL=... pnpm run validate:workforce
```

---

## 3. Rollback Git فقط (بدون restore DB)

**آمن عندما:** migrations الجديدة **additive** ولم تُطبَّق، أو طُبِّقت ولم تكسر التطبيق القديم.

- لا تشغّل `down` migrations غير موجودة في المشروع
- التطبيق القديم قد يتجاهل جداول/أعمدة جديدة (additive)

---

## 4. Restore قاعدة البيانات (حرج)

**متى:** migration أفسد schema/data، أو smoke يكشف فساداً واسعاً.

```bash
# من backup F0.2
pg_restore ...   # أو psql -f backups/pre-migrate-*.sql

# أو managed snapshot (VPS provider)
```

بعد restore:

1. أوقف API (`docker compose stop api` أو `pm2 stop`)
2. استعد backup **قبل** migration الفاشل
3. rollback تطبيق إلى SHA متوافق مع schema الـ backup
4. `pnpm run validate:workforce`
5. `pnpm run test:smoke` (staging أولاً)

---

## 5. Rollback CI commits

```bash
git revert <BAD_COMMIT_SHA>   # أو checkout tag سابق
# لا force-push على main إلا بموافقة Ops
```

---

## 6. تواصل الحادث (Ops)

1. وقت البدء / الاكتشاف  
2. SHA المُنشر vs SHA المُ rolled back  
3. هل DB restored؟ (نعم/لا + مسار backup)  
4. نتيجة `validate:workforce` و `test:smoke`  
5. RCA مختصر + ticket متابعة (F1+)

---

## 7. ما لا تفعله

- ❌ `git push --force` على `main` بدون موافقة  
- ❌ حذف volumes Docker (`postgres_data`) بدون backup  
- ❌ تشغيل migrations على prod بدون `db:backup`  
- ❌ rollback DB + app بترتيب عشوائي — **أوقف الخدمة أولاً**

---

*مرجع deploy:* [deploy.md](./deploy.md)
