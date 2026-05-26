# جدول الاختبارات — الفيز 9 و 10

معايير منصات الأعمال: أداء قابل للقياس، فصل العمال، تدرّج cutover، وبوابات CI قبل النشر.

## بوابات CI (كل merge)

| # | الاختبار | الأمر | معيار القبول |
|---|----------|--------|----------------|
| 1 | Migration journal | `pnpm run validate:migration-journal` | `ok: true` |
| 2 | OpenAPI drift | `pnpm run validate:openapi-drift` | `issues: []` |
| 3 | Unit API | `pnpm --filter @workspace/api-server test` | 0 failures |
| 4 | Unit UI | `pnpm --filter @workspace/ops-platform test` | 0 failures |
| 5 | Build API | `pnpm --filter @workspace/api-server run build` | exit 0 |
| 6 | DB integrity | `validate:workforce` + `validate:payroll` (CI job) | exit 0 |

## قبل نشر الإنتاج (يدوي)

| # | الاختبار | الأمر / الإجراء | معيار القبول |
|---|----------|-----------------|--------------|
| P1 | Migrations | `pnpm run db:migrate` | حتى `0037` بلا أخطاء |
| P2 | Canonical cutover | `pnpm run validate:canonical-cutover` | exit 0 |
| P3 | Smoke | `pnpm run test:smoke` | exit 0 |
| P4 | Health metrics | `GET /api/health/metrics` (super_admin) | Prometheus text |
| P5 | Redis (إن مُفعّل) | `GET /api/health/redis` | `ok: true` |
| P6 | Read replica (إن مُفعّل) | `GET /api/health/read-replica` | `configured: true` |
| P7 | Worker drain | `WORKER_MODE=worker` process up | logs "Background workers started" |
| P8 | API-only mode | `WORKER_MODE=api` — no duplicate job logs | workers disabled on API |

## F9 — أداء Phase 1

| # | الاختبار | الأداة | معيار القبول (هدف) |
|---|----------|--------|---------------------|
| 9.1 | Load core API | k6 (انظر `scripts/load/k6-core.js`) | 500 VUs, p95 &lt; 500ms على `/api/healthz` + `/api/hr/employees?limit=50` |
| 9.2 | Pagination | Manual / integration | `limit` افتراضي 50، أقصى 200؛ tickets يعيد ≤50 |
| 9.3 | Export كبير | HR export roster | &gt;1000 صف → `mode=async` (job) |
| 9.4 | LCP employee detail | Lighthouse (staging) | تحميل تبويب واحد فقط عند الفتح |
| 9.5 | Static cache | `curl -I` على `*.js` | `Cache-Control: public, immutable` |

### تشغيل k6 (مثال)

```bash
cd data-core-main
k6 run -e BASE_URL=https://staging.example.com -e AUTH_TOKEN=... scripts/load/k6-core.js
```

## F10 — Scale Phase 2

| # | الاختبار | الإجراء | معيار القبول |
|---|----------|---------|--------------|
| 10.1 | Redis optional | إيقاف `REDIS_URL` | المنصة تعمل (memory fallback) |
| 10.2 | Worker import | تشغيل export job | HTTP لا يتجمد؛ worker يكمل job |
| 10.3 | Read lag | `pg_stat_replication` | lag &lt; 5s للتقارير |
| 10.4 | S3 upload | `S3_*` env + attachment | PUT ناجح أو fallback محلي |
| 10.5 | 2× API + worker | LB + 2 API (`WORKER_MODE=api`) + 1 worker | jobs تُستهلَك مرة واحدة |

## تكرار الاختبارات

| التكرار | الفئة |
|---------|--------|
| كل commit | CI gates |
| أسبوعي (staging) | k6 smoke 50 VUs |
| قبل كل release | جدول «قبل نشر الإنتاج» كاملاً |
| ربع سنوي | k6 500 VUs + استعادة DB |

## Rollback

| المشكلة | إجراء |
|---------|--------|
| PM2 cluster SSE | `instances: 1` |
| Worker split | `WORKER_MODE=embedded` |
| Redis | أزل `REDIS_URL` |
| Read replica | أزل `DATABASE_READ_URL` |
