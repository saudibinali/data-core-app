# Workforce Timeline Runtime — Phase 4

**Status:** Implemented

---

## Purpose

Unified operational history feed for HR — onboarding, movements, documents, profile changes, lifecycle, approvals.

## Table

`workforce_timeline_events`

| Column | Purpose |
|--------|---------|
| event_category | profile, document, contract, movement, lifecycle, approval, note, activity |
| event_type | Specific action code |
| title / description | Human-readable feed |
| occurred_at | Display ordering |
| correlation_id | Links lifecycle / approval chains |
| source_table / source_id | Traceability |

## API

| Method | Path |
|--------|------|
| GET | `/hr/employees/:id/timeline?limit=100` |

## Writers (automatic)

| Trigger | Category |
|---------|----------|
| PATCH employee profile | profile |
| Document upload | document |
| Movement recorded | movement |
| Lifecycle initiate/complete | lifecycle |

Legacy `hr_employee_activity` remains; timeline is additive.

## Implementation

- Service: `timeline-service.ts` (`appendTimelineEvent`, `getEmployeeTimeline`)
- UI: **Timeline** tab on employee detail page
