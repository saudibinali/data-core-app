# @workspace/core-approvals

## المسؤولية

تعريف العقود المشتركة لنظام الموافقات متعدد المستويات. الموافقات يمكن أن تُرفق بالتذاكر، طلبات HR، إرسالات النماذج، أو أي كيان يحتاج توقيع بشري قبل المتابعة.

---

## ما تملكه هذه الحزمة

- `ApprovalContext` — السياق الكامل لطلب الموافقة الواحد
- `ApprovalStatus` — دورة حياة الموافقة (`pending → approved/rejected/cancelled/expired`)
- `ApprovalEntityRef` — مرجع عام للكيان الذي تحمي الموافقةُ تقدّمه
- `ApprovalDecision` — البيانات المُرسَلة عند اتخاذ قرار

## ما لا تملكه

- ❌ منطق الموافقة (approve/reject handlers) — يعيش في `api-server/src/routes/approvals.ts`
- ❌ جدول قاعدة البيانات — يعيش في `lib/db/src/schema/approvals.ts`
- ❌ واجهة المستخدم — تعيش في `ops-platform/src/pages/approvals.tsx`
- ❌ إرسال الإشعارات — مسؤولية `core-notifications`

## الحدود المستقبلية (Future Boundaries)

```
core-approvals
  ├── تستورد من: core-events (ISOTimestamp, UserId, WorkspaceId)
  └── تستورد منها: core-notifications (لإرسال إشعار عند طلب موافقة)
```

## مثال استخدام مستقبلي

```typescript
import type { ApprovalContext, ApprovalDecision } from "@workspace/core-approvals";

function renderApprovalCard(ctx: ApprovalContext) {
  // ctx.entity.entityType  === "ticket" | "hr.leave_request" | ...
  // ctx.status             === "pending"
  // ctx.assignedTo         — the user who must act
}

async function submitDecision(decision: ApprovalDecision) {
  // POST /api/approvals/:id/approve  or  /reject
}
```

## الوضع الحالي

**Foundation placeholder** — الأنواع معرّفة لكن لا يوجد ربط فعلي.
`ApprovalEntityRef` مُصمَّم عمداً بشكل عام ليدعم التذاكر وطلبات HR والنماذج بنفس الشكل.
التذكرة القادمة: ربط `requiresApproval` flag في workflow steps بـ `ApprovalContext`.
