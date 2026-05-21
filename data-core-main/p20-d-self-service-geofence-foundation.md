# P20-D — Self-Service Clocking & Geofence Foundation

## Overview

Phase 20-D adds **employee self-service clocking** with optional **geofence validation** (warning-first), **attendance policies**, and a web UI—built on the P20-B canonical ingestion pipeline without mobile apps, live tracking, or vendor SDKs.

## Self-Service Flow

```
Employee → /self-service/attendance (UI)
  → GET /hr/workforce/me/status
  → optional browser geolocation (punch-time only)
  → POST /hr/workforce/clock-in | clock-out
  → executeWebClock()
       → policy + geofence validation + warnings
       → AttendanceIngestionService → normalization → summary → hr_attendance
  → notifications for warnings (optional)
```

### APIs

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/hr/workforce/me/status` | Current clock state, today minutes, warnings |
| GET | `/hr/workforce/me/today` | Today summary + legacy bridge |
| GET | `/hr/workforce/me/history` | Last 90 days from `hr_attendance` |
| POST | `/hr/workforce/clock-in` | Self clock in (`source=web`) |
| POST | `/hr/workforce/clock-out` | Self clock out |

Admin foundation:

| Method | Route |
|--------|-------|
| GET/POST | `/hr/workforce/geofences` |
| GET/POST | `/hr/workforce/policies` |

## Geofence Flow

1. Load active `attendance_geofences` for workspace (prefer employee `work_location_id` match)
2. Haversine distance vs `radius_meters + accuracy_buffer`
3. **Default:** warning only (`suspiciousLocationAction: flag`, `geofenceRequired: false`)
4. **Reject** only if policy sets `geofenceRequired: true` AND `suspiciousLocationAction: reject`

Circle radius only—no polygons in P20-D.

## Policy Validation

`attendance_policies.policy_json`:

| Field | Default | Purpose |
|-------|---------|---------|
| `geofenceRequired` | false | Hard require location + geofence |
| `allowRemoteClock` | true | Allow clock without GPS |
| `suspiciousLocationAction` | flag | flag / review / reject |
| `minAccuracyMeters` | 100 | Low accuracy warning |
| `graceMinutes` | 15 | Shift grace (summary builder) |
| `duplicateWindowSeconds` | 60 | Duplicate punch detection |

Seeded per workspace on API init.

## Warning Lifecycle

Warnings generated at clock time:

| Code | Trigger |
|------|---------|
| `out_of_geofence` | Outside radius + buffer |
| `low_accuracy` | GPS accuracy > threshold |
| `duplicate_clock` | Same event type within window |
| `suspicious_velocity` | >200 km/h since last punch |
| `missing_clock_out` | Clocked in, no out after 18:00 local |

Stored in `attendance_raw_events.payload_json` and echoed in `attendance_events.location_json` metadata.

Notifications: `attendance_clock_flag` / `attendance_clock_warning` via `dispatchUserNotification`.

## Privacy Model

- Location captured **only when employee punches** (optional checkbox in UI)
- No background tracking tables or workers
- Employee sees own punches and warnings
- Managers use existing `hr.manage` reports (location not in standard export columns by default)
- `logAttendanceAccess` structured logs for clock actions (retention hooks via log pipeline)
- Payload includes `privacy: { punchTimeOnly: true }`

## Work Location Assignment

Uses existing `employees.work_location_id` → `hr_work_locations` for geofence lookup preference. No new scheduling engine.

## Reporting Compatibility

`hr.attendance.period` unchanged data source (`hr_attendance`). Added columns:

- **Source** (`source_type`)
- **Geofence Flag** (web/mobile indicator)

## Database (migration 0008)

- `attendance_geofences`
- `attendance_policies`

## Remaining Gaps (P20-E+)

- Mobile native app & offline queue
- Vendor device connectors
- Polygon geofences / map picker UI
- Policy builder UI
- Dedicated `attendance_access_logs` table
- Production hard reject rollout per workspace
- Manager geofence review queue UI
- Biometric / kiosk

## Key Files

| Area | Path |
|------|------|
| Schema | `lib/db/src/schema/workforce-geofence.ts` |
| Services | `geofence-validation-service.ts`, `clock-service.ts`, `self-service-attendance-service.ts` |
| Routes | `routes/workforce-attendance.ts` |
| UI | `ops-platform/src/pages/hr-me-attendance.tsx` |
| Tests | `routes/__tests__/workforce-self-service.smoke.test.ts` |
