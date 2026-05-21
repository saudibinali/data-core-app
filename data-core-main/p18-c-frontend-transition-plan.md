# P18-C — Frontend Transition Plan

**Date:** 2026-05-19  
**Type:** Planning only — no UI changes.

---

## 1. Surfaces inventory

| Surface | File | Audience | Current APIs |
|---------|------|----------|--------------|
| Self-service leave | `hr-me-leave.tsx` | Employee | `GET /hr/me/leave-balances`, `GET /hr/attendance/leaves`, `POST /hr/me/leave-requests`, `GET /hr/foundation/leave-policies` |
| Self-service hub | `self-service.tsx` | Employee | Links to `/self-service/leave` |
| Attendance & leave admin | `hr-attendance.tsx` | HR (`hr.manage`) | `GET /hr/attendance/leaves`, `PATCH /hr/attendance/leaves/:id`, balances, policies |
| Employee detail leaves | `hr-employee-detail.tsx` | HR | `GET/POST /hr/employees/:id/leaves` |
| Route guard | `App.tsx` | — | `/self-service/leave` — **no** `requiredPermission` (only `moduleKey="hr"`) |

**Manager approval UI:** Embedded in `hr-attendance.tsx` (approve/reject buttons) — **no** dedicated manager inbox page.

---

## 2. Current vs future API usage

### 2.1 `hr-me-leave.tsx`

| Concern | Current | Future (canonical) |
|---------|---------|-------------------|
| Balances | `GET /api/hr/me/leave-balances?year=` | **Unchanged** (already canonical table) |
| List requests | `GET /api/hr/attendance/leaves` | `GET /api/hr/leave-requests` (employee-filtered server-side) |
| Submit | `POST /api/hr/me/leave-requests` | `POST /api/hr/leave-requests` body: `leaveType`, `startDate`, `endDate`, `employeeNote`, `leavePolicyId` |
| Policies | `GET /api/hr/foundation/leave-policies` | `GET /api/hr/me/leave-policies` **or** self-service policy endpoint (permission fix needed) |
| Day count display | Client calendar days | Show `businessDaysCount` from response; optional preview endpoint later |

### 2.2 `hr-attendance.tsx` (Leaves tab)

| Concern | Current | Future |
|---------|---------|--------|
| List | `GET /hr/attendance/leaves?status=` | `GET /hr/leave-requests?status=&employeeId=` |
| Approve | `PATCH /hr/attendance/leaves/:id` `{ status }` | `PATCH /hr/leave-requests/:id/approve` `{ comment }` |
| Reject | same with `rejected` | `PATCH .../reject` |
| Display fields | `reason`, `daysCount` | `requestNumber`, `employeeNote`, `businessDaysCount`, `currentApproverId` |
| Status badges | pending/approved/rejected/cancelled | Add `pending_approval`, `withdrawn` |

### 2.3 `hr-employee-detail.tsx` (Leaves tab)

| Concern | Current | Future |
|---------|---------|--------|
| List | `GET /hr/employees/:id/leaves` | `GET /hr/leave-requests?employeeId=` |
| Add (HR) | `POST /hr/employees/:id/leaves` | Blocked until HR-on-behalf canonical API exists — interim: keep legacy read-only + link to admin flow |

---

## 3. Known defects to fix during transition (documented, not fixed in P18-C)

| ID | Issue | Impact |
|----|-------|--------|
| F1 | `myLeavesQ` calls admin-only `GET /hr/attendance/leaves` | Employees likely see **empty list or 403** |
| F2 | `policiesQ` calls `GET /hr/foundation/leave-policies` (`hr.view`) | Employees may not see policies dropdown |
| F3 | Client `daysCount` sent to legacy POST; canonical ignores client business days | Balance mismatch if UI switches without server calc display |
| F4 | No UI for `withdraw` on canonical | Employee cannot cancel pending via UI |
| F5 | Status labels missing `pending_approval`, `withdrawn` | Wrong badges after cutover |

---

## 4. Required UI changes (later — L3)

1. **Submit mutation** → `POST /hr/leave-requests`; map `reason` → `employeeNote`.
2. **List query** → `GET /hr/leave-requests`; map response shape (`leaveRequest` wrapper vs array).
3. **Status map** — extend `LEAVE_STATUS` constant.
4. **Show `requestNumber`** in list cards.
5. **Policies** — use endpoint accessible with `requireAuth` only (backend prerequisite).
6. **Optional:** Withdraw button → `PATCH .../withdraw` for own pending requests.
7. **Attendance tab** — swap approve mutations; show approver queue filter `status=pending_approval`.

---

## 5. Backward compatibility

| Period | Strategy |
|--------|----------|
| L3a | Feature flag `USE_CANONICAL_LEAVE` — off in prod until staging sign-off |
| L3b | On flag on: canonical only for submit/list; balances unchanged |
| L4 | After data migration: show legacy rows in separate “Historical (pre-2026)” section **or** merged list with badge `Legacy` if read-merge API built |

**Query keys:** Change React Query keys from `/hr/me/leaves` to `/hr/leave-requests` to avoid cache bleed.

---

## 6. Loading / state risks

| Risk | Mitigation |
|------|------------|
| 403 on list after cutover | Fix API permission before UI switch |
| Double submit | Disable button on mutation; canonical returns 409 on conflict |
| Stale balances | Invalidate `["/hr/me/leave-balances"]` on submit/approve |
| Partial error messages | Map 422 balance errors to toast |
| RTL / i18n | Add strings for new statuses |

---

## 7. Rollout sequence (frontend)

| Step | Action |
|------|--------|
| 1 | Backend L1 + staging API tests (no UI) |
| 2 | Fix self-service **read** API permissions or dedicated `/hr/me/leave-requests` list |
| 3 | Ship `hr-me-leave.tsx` behind flag in staging |
| 4 | Ship `hr-attendance.tsx` manager actions |
| 5 | Employee detail read-only legacy + link |
| 6 | Enable flag in production |
| 7 | Remove legacy API calls from frontend after L5 freeze |

---

## 8. Manager approval UI

**Current:** HR users with `hr.manage` use Attendance → Leaves tab.

**Future:** Same tab; optionally add **“My team approvals”** for managers without full `hr.manage` (requires permission model later — out of scope).

Canonical approve uses **approver identity** from step, not only `hr.manage`.

---

**Confirmation:** No frontend files modified in P18-C.
