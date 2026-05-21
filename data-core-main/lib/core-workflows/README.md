# @workspace/core-workflows

## المسؤولية

العقود المشتركة لمحرك الأتمتة (Workflow Engine). تُعرّف الأشكال البنيوية للـ trigger، step، وexecution record التي تستخدمها كل من: المحرك (api-server) وبانية الواجهة (ops-platform).

---

## ما تملكه هذه الحزمة

- `WorkflowDefinition` — التعريف الكامل المحفوظ لسير العمل
- `WorkflowTrigger` / `WorkflowTriggerCondition` — ما يُفعِّل سير العمل وشروطه
- `WorkflowStep` — خطوة أتمتة واحدة داخل سير العمل
- `WorkflowStepType` — أنواع الخطوات: `notification`, `approval`, `task`, `condition`...
- `WorkflowExecution` — سجل تشغيل واحد لسير عمل
- `WorkflowExecutionStatus` — دورة حياة التشغيل

## ما لا تملكه

- ❌ منطق تنفيذ الخطوات — يعيش في `api-server/src/lib/workflows/executor.ts`
- ❌ تقييم الشروط — يعيش في `api-server/src/lib/workflows/conditions.ts`
- ❌ المستمعون على الأحداث — يعيشون في `api-server/src/lib/workflows/engine.ts`
- ❌ جداول قاعدة البيانات — تعيش في `lib/db/src/schema/workflows.ts`
- ❌ واجهة بناء سير العمل — تعيش في `ops-platform/src/pages/workflows.tsx`

## الحدود المستقبلية (Future Boundaries)

```
core-workflows
  ├── تستورد من: core-events (BaseEvent, ISOTimestamp)
  └── تُستورَد من: api-server/lib/workflows/*, ops-platform/pages/workflows*
```

## مثال استخدام مستقبلي

```typescript
import type { WorkflowDefinition, WorkflowTrigger } from "@workspace/core-workflows";

const trigger: WorkflowTrigger = {
  eventType: "ticket.created",
  conditions: [
    { field: "data.priority", operator: "eq", value: "urgent" },
  ],
};

const workflow: WorkflowDefinition = {
  id: 1,
  workspaceId: 1,
  name: "Auto-assign urgent tickets",
  isActive: true,
  trigger,
  steps: [
    { id: "step-1", type: "assignment", label: "Assign to on-call", config: { assignTo: "on_call_user" } },
    { id: "step-2", type: "notification", label: "Notify manager", config: { templateId: "urgent-ticket" }, dependsOn: ["step-1"] },
  ],
  createdAt: "2026-05-13T00:00:00Z",
  updatedAt: "2026-05-13T00:00:00Z",
};
```

## الوضع الحالي

**Foundation placeholder** — الأنواع معرّفة لكن لا يوجد ربط فعلي.
محرك الـ workflows الحالي في api-server يعرّف `StepType` و`WorkflowCondition` محلياً.
التذكرة القادمة: توحيد أنواع المحرك الحالي مع هذه الحزمة دون تغيير السلوك.
