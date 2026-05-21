# @workspace/core-notifications

## المسؤولية

العقد المشترك لنظام الإشعارات — القناة المرئية لنظام الأحداث من منظور المستخدم. كل إشعار مرتبط بـ workspace ويستهدف مستخدماً محدداً.

---

## ما تملكه هذه الحزمة

- `NotificationPayload` — كل ما يحتاجه النظام لإنشاء إشعار وإرساله
- `NotificationRecord` — الشكل المخزَّن بعد كتابة الإشعار في قاعدة البيانات
- `NotificationChannel` — القنوات المتاحة: `in_app` | `email` | `push`
- `NotificationSeverity` — مستوى الأهمية: `info` | `success` | `warning` | `error`

## ما لا تملكه

- ❌ منطق الإرسال (SSE dispatcher) — يعيش في `api-server/src/lib/sse.ts`
- ❌ إرسال البريد — يعيش في `api-server/src/lib/email.ts`
- ❌ جدول قاعدة البيانات — يعيش في `lib/db/src/schema/notifications.ts`
- ❌ مكون الإشعارات في الواجهة — يعيش في `ops-platform/src/pages/notifications.tsx`

## الحدود المستقبلية (Future Boundaries)

```
core-notifications
  ├── تستورد من: core-events (ISOTimestamp, UserId, WorkspaceId)
  └── تستورد منها: core-approvals, core-workflows, core-audit (لإطلاق إشعارات)
```

قاعدة صارمة: `core-notifications` لا تعرف شيئاً عن domain منطق أي module. تستقبل `NotificationPayload` وتُسلِّمه للقناة المناسبة.

## مثال استخدام مستقبلي

```typescript
import type { NotificationPayload } from "@workspace/core-notifications";

const payload: NotificationPayload = {
  workspaceId: 1,
  userId: 42,
  title: "طلب موافقة جديد",
  body: "التذكرة #99 تنتظر موافقتك",
  severity: "info",
  actionUrl: "/tickets/99",
  sourceModule: "approvals",
  sourceEntityId: 15,
  channels: ["in_app", "email"],
};
```

## الوضع الحالي

**Foundation placeholder** — الأنواع معرّفة لكن لا يوجد ربط فعلي.
قناة `push` محجوزة للمستقبل (PWA / mobile push notifications).
التذكرة القادمة: استبدال `Record<string,unknown>` في listeners الحاليين بـ `NotificationPayload`.
