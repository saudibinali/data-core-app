# @workspace/core-permissions

## المسؤولية

نموذج الصلاحيات المرجعي للمنصة — يجمع التحكم القائم على الأدوار (RBAC) مع الأسس اللازمة للتحكم القائم على السمات (ABAC). يعرّف المفردات المشتركة للتعبير عن الصلاحيات والتحقق منها وتوسيعها.

---

## ما تملكه هذه الحزمة

- `BuiltInRole` — الأدوار الثابتة للمنصة: `super_admin` → `admin` → `manager` → `member`
- `PermissionKey` — معرّف الصلاحية بتنسيق `resource.action` (مثل `"tickets.delete.any"`)
- `PermissionActor` — الفاعل موضوع فحص الصلاحية (يعكس بيانات `requireAuth` middleware)
- `PermissionCheckRequest` / `PermissionCheckResult` — عقد عملية الفحص
- `WorkspaceRoleRef` — مرجع للأدوار المخصصة per-workspace

## ما لا تملكه

- ❌ خوارزمية الفحص (evaluator) — ستعيش في api-server مستقبلاً
- ❌ جدول الأدوار المخصصة — يعيش في `lib/db/src/schema/custom-roles.ts`
- ❌ middleware التحقق من الصلاحيات — يعيش في `api-server/src/middlewares/`
- ❌ واجهة إدارة الأدوار — تعيش في `ops-platform/src/pages/roles.tsx`

## الحدود المستقبلية (Future Boundaries)

```
core-permissions
  ├── لا تستورد من أي core-* package أخرى (مستقلة تماماً)
  └── تُستورَد من: middlewares, route guards, UI permission hooks
```

`core-permissions` يجب أن تبقى **خالية من أي dependency** — لا `core-events`، لا DB، لا Express.

## مثال استخدام مستقبلي

```typescript
import type { PermissionCheckRequest, PermissionCheckResult } from "@workspace/core-permissions";

function checkPermission(req: PermissionCheckRequest): PermissionCheckResult {
  const { actor, permission } = req;

  if (actor.role === "super_admin") {
    return { granted: true };
  }

  // ... RBAC matrix lookup
  return { granted: false, reason: `Role '${actor.role}' cannot '${permission}'` };
}
```

## الوضع الحالي

**Foundation placeholder** — الأنواع معرّفة لكن لا يوجد ربط فعلي.
الكود الحالي يتحقق من الأدوار مباشرةً في كل route handler بدون مكتبة مركزية.
التذكرة القادمة: بناء `PermissionEvaluator` في api-server يستورد الأنواع من هنا.
