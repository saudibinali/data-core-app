# @workspace/core-audit

## المسؤولية

سجل التدقيق الثابت (Immutable Audit Trail) لكل العمليات التي تُغيّر حالة الأعمال. كل عملية كتابة مهمة يجب أن تُنتج `AuditRecord`. السجل append-only — لا يُحذف ولا يُعدَّل أي سجل.

---

## ما تملكه هذه الحزمة

- `AuditRecord` — سجل تدقيق واحد لا يمكن تعديله
- `AuditEmitRequest` — ما يرسله المستدعي لإنشاء سجل (بدون `id` و `occurredAt`)
- `AuditAction` — تصنيف موحّد لنوع العملية (`created`, `updated`, `approved`...)
- `AuditEntityRef` — مرجع للكيان الذي خضع للعملية

## ما لا تملكه

- ❌ كتابة السجلات في قاعدة البيانات — مسؤولية audit service في api-server
- ❌ قراءة/عرض السجلات — مسؤولية `activity` routes و UI
- ❌ سياسات الاحتفاظ بالبيانات (retention) — ستُعرَّف في platform-settings مستقبلاً
- ❌ تصدير السجلات — feature مستقبلي

## الحدود المستقبلية (Future Boundaries)

```
core-audit
  ├── تستورد من: core-events (ISOTimestamp, UserId, WorkspaceId)
  └── تُستورَد من: كل module يريد إصدار سجل تدقيق
```

قاعدة: كل module يُصدر `AuditEmitRequest` — لا يكتب في جدول audit مباشرةً.

## مثال استخدام مستقبلي

```typescript
import type { AuditEmitRequest } from "@workspace/core-audit";

const entry: AuditEmitRequest = {
  workspaceId: 1,
  actorId: 42,
  action: "approved",
  entity: {
    entityType: "ticket",
    entityId: 99,
    entityLabel: "طلب إجازة — أحمد محمد",
  },
  metadata: { previousStatus: "pending", newStatus: "approved" },
  ipAddress: "10.0.0.1",
};

await auditService.emit(entry);
```

## الوضع الحالي

**Foundation placeholder** — الأنواع معرّفة لكن لا يوجد ربط فعلي.
السجلات الحالية تعيش في `lib/db/src/schema/activity.ts` بشكل حر (free-form).
التذكرة القادمة: توحيد سجلات النشاط الحالية لتتطابق مع `AuditRecord` ثم الاستيراد من هنا.
