# P18-D2 — Bridge Behavior Documentation

**Date:** 2026-05-19  
**Phase:** Canonical read bridge (legacy write unchanged)

---

## 1. Current read/write behavior

| Surface | READ | WRITE |
|---------|------|-------|
| Self-service `hr-me-leave.tsx` | **Canonical-first** `GET /hr/leave-requests` (+ legacy list not used for employees) | **Legacy** `POST /hr/me/leave-requests` → `hr_employee_leaves` |
| Attendance admin leaves tab | **Merged** canonical `GET /hr/leave-requests` + legacy `GET /hr/attendance/leaves` | **Legacy** `PATCH /hr/attendance/leaves/:id` (legacy rows only) |
| Employee detail leaves tab | **Merged** canonical by `employeeId` + legacy `GET /hr/employees/:id/leaves` | **Legacy** `POST /hr/employees/:id/leaves` |
| Policies (self-service) | **New** `GET /hr/me/leave-policies` | Unchanged (admin foundation routes) |

---

## 2. Canonical-first strategy

1. Attempt canonical read API.
2. For HR admin views, also load legacy admin list and **append** (no deduplication by date — different IDs).
3. Normalize to `NormalizedLeaveRow` via `artifacts/ops-platform/src/lib/leave-bridge.ts`.
4. UI renders unified list; `source` field distinguishes rows internally.

**No dual-write:** Legacy POST does not insert into `leave_requests`.

---

## 3. Fallback rules

| Scenario | Behavior |
|----------|----------|
| Canonical table missing / API error | Employee list empty or partial; admin may still see legacy via `includeLegacyAdmin` |
| Employee has only legacy rows | Shown from legacy fetch (employee detail); self-service canonical list empty until migrated |
| Admin approves from attendance UI | **Only** `source=legacy` + `status=pending` shows approve/reject buttons |
| Canonical `pending_approval` | Visible in list; approval via canonical PATCH deferred to P18-D3+ |

---

## 4. Transitional states (UI)

Supported status labels:

- `pending`, `pending_approval`, `approved`, `rejected`, `withdrawn`, `cancelled`

Legacy `pending` maps visually to pending family; canonical uses `pending_approval` for new submits.

---

## 5. API adjustments (minimal)

| Endpoint | Change |
|----------|--------|
| `GET /hr/leave-requests` | HR scope includes `hr.manage` / `hr.view`; employee scope by `employees.user_id`; status filter `pending` includes `pending_approval`; joins employee name |
| `GET /hr/leave-requests/:id` | Access via requester **or** linked employee user |
| `GET /hr/me/leave-policies` | **New** — self-service read active policies (no `hr.view`) |

---

## 6. What is still legacy

- All **write** paths (`POST /hr/me/leave-requests`, employee nested POST, attendance PATCH approve)
- Table `hr_employee_leaves` (unchanged)
- Balance updates on legacy approve path
- Canonical approve/reject/withdraw **not** wired in admin UI yet

---

## 7. What became canonical-read

- Self-service leave **history list**
- Admin leave **listing** (canonical rows + legacy rows)
- Employee profile leave **tab** (canonical + legacy)
- Self-service **policy picker** data source

---

## 8. Known limitations

- Duplicate-looking rows possible (same dates in both tables) until data migration
- Admin cannot approve canonical rows from attendance UI in P18-D2
- `GET /hr/attendance/leaves` still exists for legacy tooling; employees should use `GET /hr/leave-requests`
- No pagination UI (API limit 200 on canonical list)

---

## 9. Helper module

`artifacts/ops-platform/src/lib/leave-bridge.ts`

- `normalizeCanonicalLeave` / `normalizeLegacyLeave`
- `fetchLeaveListBridge`
- `fetchMeLeavePolicies`
- `LEAVE_STATUS_UI`

---

**Confirmation:** No dual-write. No legacy removal. No schema changes.
