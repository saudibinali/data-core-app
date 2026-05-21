# P20-A — GPS / Geofence Attendance Strategy

**Phase:** P20-A (planning only — **no GPS implementation**)  
**Date:** 2026-05-19

---

## 1. Objectives

- Allow mobile/web clock-in **only when within approved site boundary** (optional per workspace)  
- Preserve **employee privacy** and regulatory compliance  
- Detect **obvious spoofing** without claiming forensic certainty  
- Support **offline queue** on mobile (future) with post-sync validation flags  

---

## 2. Geofence model

Uses planned `attendance_geofences` (see canonical models):

| Field | Purpose |
|-------|---------|
| `work_location_id` | Link to `hr_work_locations` |
| `latitude`, `longitude` | Center point (WGS84) |
| `radius_meters` | Allowed circle (e.g. 100–500m) |
| `is_active` | Soft disable |

**Branch setup flow (future UI):**

1. HR selects work location or creates site  
2. Pin on map or enter coordinates  
3. Set radius and grace buffer  
4. Assign to org units or shift schedules  

---

## 3. Clock-in validation flow

```
Mobile/Web clock request
  → Auth employee
  → Load applicable geofences (by location assignment or default site)
  → If geofence required:
        compute haversine distance
        if distance > radius + accuracy_buffer → reject (code: OUT_OF_GEOFENCE)
  → Attach location_json { lat, lng, accuracy_m, captured_at, provider }
  → Create attendance_event (pending_validation if accuracy poor)
  → Normalize into daily summary
```

**Accuracy buffer:** Add `max(50m, reported_accuracy * 2)` to radius to reduce false rejects.

---

## 4. Allowed radius guidelines

| Site type | Typical radius |
|-----------|----------------|
| Single office | 150–300 m |
| Campus | 500–1000 m |
| Remote / WFH | Geofence disabled; status `remote` |
| Construction / field | Per-site polygon (phase 2; start with circle) |

---

## 5. Spoofing & fraud risks

| Risk | Mitigation (planned) |
|------|----------------------|
| GPS mock apps | Server-side plausibility checks; flag `location_trust_score` low; manager review queue |
| Emulator | Device attestation (mobile phase); web cannot fully prevent |
| Buddy punching | Optional selfie/PIN at kiosk (out of scope P20-A) |
| Stale location | Reject if `captured_at` older than 5 minutes |
| Velocity check | Reject if last punch > 200 km away within 30 min |

**Policy:** Flag suspicious events; do not auto-terminate employment.

---

## 6. Privacy boundaries

| Principle | Implementation |
|-----------|----------------|
| **Purpose limitation** | Location collected only at punch time, not continuous tracking |
| **Transparency** | Employee consent in policy; show “location required for clock-in” |
| **Minimization** | Store coordinates on event; no background trail table |
| **Retention** | Align with attendance retention policy (e.g. 2 years) then purge coordinates |
| **Access** | Employee sees own punches; managers see team only with permission |
| **Export** | Location excluded from standard exports unless compliance role |

---

## 7. Audit logs

For each geofence-validated clock:

- `attendance_events.location_json`  
- `attendance_raw_events` if from mobile SDK payload  
- `document_access_logs` pattern: optional `attendance_access_logs` for view/export of location  
- Adjustment record if HR overrides reject  

---

## 8. Offline handling (future)

| Scenario | Behavior |
|----------|----------|
| Device offline at punch | Queue encrypted event locally; timestamp from device |
| Sync on reconnect | Server accepts with `offline=true`; validate geofence at sync time (lenient) or mark `needs_review` |
| Conflict | Server event time wins if duplicate; idempotency key from client UUID |

**P20-A:** Document only.

---

## 9. Mobile vs web limitations

| Capability | Web | Native mobile (future) |
|------------|-----|------------------------|
| GPS accuracy | Browser geolocation API; variable | Higher with fused location |
| Background | Not supported | Queue offline punches |
| Attestation | Weak | Stronger |
| Biometric | None | Optional OS biometric for app open |

**Phase 1 recommendation:** Web clock with optional geolocation + clear “low accuracy” warning.

---

## 10. Integration with policies

`attendance_policies.policy_json` keys:

- `geofenceRequired: boolean`  
- `minLocationAccuracyMeters: number`  
- `allowRemoteClock: boolean`  
- `suspiciousLocationAction: reject | flag | allow`  

---

## 11. Readiness

| Item | P20-A status |
|------|----------------|
| Schema | Designed (`attendance_geofences`) |
| API | Not implemented |
| Mobile app | Not implemented |
| Map UI | Not implemented |

**Verdict:** **BLOCKED** for production GPS until P20-D+.

---

**Related:** `p20-a-attendance-security-compliance.md`
