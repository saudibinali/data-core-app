# @workspace/core-events

## المسؤولية

الحزمة المرجعية لعقود نظام الأحداث عبر المنصة بأكملها. تعرّف:
- البنية الأساسية لكل حدث (envelope architecture)
- الأنواع المُحدَّدة لكل حدث في النظام (typed payloads)
- سجل أسماء الأحداث وخريطة الأنواع (EventTypeMap)

---

## Naming Convention — قرار التسمية

### الاختيار: `entity.action` (مستويان، فاصلة نقطية)

```
entity.action           ← المعيار
entity.sub_action       ← أفعال مركبة — snake_case وليس مستوى ثالث
```

### أمثلة صحيحة
```
ticket.created          ✓
ticket.updated          ✓
ticket.status_changed   ✓  (مركب بـ snake_case)
leave.requested         ✓
approval.created        ✓
workflow.executed       ✓
```

### أمثلة خاطئة
```
forms.form.submitted    ✗  (legacy — 3 مستويات، سيُعاد تسميته في Ticket 03)
ticket.statusChanged    ✗  (camelCase لا يُستخدم)
tickets.create          ✗  (جمع + مضارع)
```

### سبب الاختيار
1. يطابق 95% من الأحداث الموجودة حالياً — أقل مساحة للـ migration
2. يُقرأ بشكل طبيعي في workflow builder: "عندما [ticket] يُنشأ [created]"
3. متسق مع أنماط الصناعة (Stripe webhooks، GitHub events)
4. مستويان يبقيان flat وقابلَين للبحث دون غموض 3 مستويات

---

## ما تملكه هذه الحزمة

### `src/types.ts` — بنية المغلف الأساسية
| النوع | الوصف |
|---|---|
| `BaseEvent` | المغلف الكامل لكل حدث (id, type, module, workspace, actor, metadata, data, timestamp) |
| `EventMetadata` | correlationId, causationId, schemaVersion, source, idempotencyKey |
| `ActorContext` | userId, role, sessionId, ipAddress |
| `WorkspaceContext` | workspaceId, workspaceSlug |
| `TypedEvent<TType, TData>` | generic نوع event مُحدَّد الـ payload |
| `EventListenerFn` | توقيع كل دالة مستمعة |
| `EventRegistryEntry` | metadata الأحداث في platform_event_registry |

### `src/events.ts` — عقود الأحداث المُحدَّدة (10 أحداث)
| اسم الحدث | النوع | الحالة |
|---|---|---|
| `ticket.created` | `TicketCreatedEvent` | يطابق الموجود |
| `ticket.updated` | `TicketUpdatedEvent` | يطابق الموجود |
| `ticket.status_changed` | `TicketStatusChangedEvent` | **جديد** |
| `form.submitted` | `FormSubmittedEvent` | canonical (يعوّض `forms.form.submitted`) |
| `approval.created` | `ApprovalCreatedEvent` | canonical (يعوّض `approval.requested`) |
| `approval.completed` | `ApprovalCompletedEvent` | **جديد** (مفهوم موحَّد) |
| `leave.requested` | `LeaveRequestedEvent` | يطابق الموجود |
| `employee.created` | `EmployeeCreatedEvent` | يطابق الموجود |
| `notification.created` | `NotificationCreatedEvent` | **جديد** |
| `workflow.executed` | `WorkflowExecutedEvent` | **جديد** |

### `src/constants.ts` — السجل والخريطة
| العنصر | الوصف |
|---|---|
| `EVENT_TYPES` | const object — مصدر الحقيقة لأسماء الأحداث |
| `EventType` | union لكل أسماء الأحداث المعروفة |
| `EventTypeMap` | يربط كل اسم حدث بـ payload interface المقابل |
| `AnyTypedEvent` | discriminated union — يُمكّن narrowing بـ switch |
| `IsEventTypeFn` | type guard signature للـ narrowing الآمن |
| `LEGACY_EVENT_NAMES` | خريطة الأسماء القديمة → الأسماء الكانونية |

---

## ما لا تملكه

- ❌ منطق إطلاق الأحداث (dispatcher) — يعيش في `api-server/src/lib/events/dispatcher.ts`
- ❌ قائمة المستمعين — تعيش في `api-server/src/lib/events/`
- ❌ جدول قاعدة البيانات — يعيش في `lib/db/src/schema/events.ts`
- ❌ أي import من React أو Express
- ❌ أي business logic

---

## بنية الملفات

```
lib/core-events/
├── src/
│   ├── types.ts      ← BaseEvent + envelope types (EventMetadata, ActorContext, WorkspaceContext)
│   ├── events.ts     ← 10 typed payload interfaces + TypedEvent aliases
│   ├── constants.ts  ← EVENT_TYPES, EventTypeMap, AnyTypedEvent, LEGACY_EVENT_NAMES
│   └── index.ts      ← public exports
├── README.md
├── package.json
└── tsconfig.json
```

---

## مثال استخدام مستقبلي

### إطلاق حدث (Producer)
```typescript
import { EVENT_TYPES } from "@workspace/core-events";
import type { TicketCreatedPayload } from "@workspace/core-events";

await eventDispatcher.dispatch({
  type: EVENT_TYPES.TICKET_CREATED,
  module: "tickets",
  workspace: { workspaceId: req.workspaceId },
  actor: { userId: req.userId, role: req.userRole },
  metadata: { correlationId: crypto.randomUUID(), schemaVersion: 1 },
  data: {
    ticketId: newTicket.id,
    title: newTicket.title,
    priority: newTicket.priority,
    // ... rest of TicketCreatedPayload
  } satisfies TicketCreatedPayload,
});
```

### استهلاك حدث (Consumer)
```typescript
import type { AnyTypedEvent } from "@workspace/core-events";

function handleEvent(event: AnyTypedEvent) {
  switch (event.type) {
    case "ticket.created":
      // event.data is TicketCreatedPayload ✓
      console.log(event.data.ticketId, event.data.title);
      break;

    case "approval.completed":
      // event.data is ApprovalCompletedPayload ✓
      if (event.data.outcome === "approved") { /* ... */ }
      break;
  }
}
```

### خريطة الأنواع للـ generic utilities
```typescript
import type { EventTypeMap, EVENT_TYPES } from "@workspace/core-events";

type TicketPayload = EventTypeMap["ticket.created"];
// → TicketCreatedPayload

function getPayloadType<T extends keyof EventTypeMap>(
  eventType: T
): EventTypeMap[T] {
  // typed by the map ✓
}
```

---

## تغييرات BaseEvent عن الـ EventPayload الحالي

| الحقل | EventPayload (الموجود) | BaseEvent (الكانوني) | ملاحظة |
|---|---|---|---|
| `id` | — | `string` (UUID) | **جديد** — للـ deduplication |
| `event` | `string` | ← محذوف | مُعاد تسميته |
| `type` | — | `string` | **جديد** — يعوّض `event` |
| `module` | `string` | `string` | ✓ يطابق |
| `workspaceId` | `number` | ← محذوف | نُقل لـ WorkspaceContext |
| `workspace` | — | `WorkspaceContext` | **جديد** — مهيكَل |
| `triggeredBy` | `number \| undefined` | ← محذوف | نُقل لـ ActorContext |
| `actor` | — | `ActorContext` | **جديد** — مهيكَل |
| `metadata` | — | `EventMetadata` | **جديد** — correlationId، causation |
| `data` | `Record<string, unknown>` | `Record<string, unknown>` | ✓ يطابق (مُحدَّد بـ TypedEvent) |
| `timestamp` | optional | **mandatory** | دائماً مطلوب |

---

## الوضع الحالي

**Event Contracts Architecture** — الأنواع مُعرَّفة بالكامل، لا ربط فعلي بعد.
الكود الحالي في `api-server/src/lib/events/types.ts` يعرّف `EventPayload` محلياً.
**Ticket 03**: ربط الـ dispatcher الحالي بهذه الأنواع + إضافة الأحداث الجديدة.
