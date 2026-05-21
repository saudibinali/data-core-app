# P20-A — Attendance Security & Compliance

**Phase:** P20-A (design only)  
**Date:** 2026-05-19

---

## 1. Scope

Security and compliance requirements for the Workforce Event Platform: data protection, access control, audit, anti-tampering, and retention—aligned with existing workspace isolation and P19 document/notification patterns.

---

## 2. Location privacy

| Requirement | Control |
|-------------|---------|
| Collect only at punch | No background GPS table |
| Consent | Workspace policy acknowledgment; employee-visible notice in clock UI |
| Precision storage | Round to 5 decimal places max; optional truncate for display |
| Retention | Purge coordinates N months after period close (configurable) |
| Access | `hr.manage` + location-sensitive permission; employees see own only |
| Export | Location columns excluded from standard CSV; compliance role only |

See `p20-a-gps-geofence-attendance-strategy.md`.

---

## 3. Device & integration credentials

| Asset | Protection |
|-------|------------|
| API keys / webhook secrets | Encrypted at rest; workspace-scoped |
| Device registration tokens | Short-lived JWT; bind to `device_uid` |
| Biometric templates | **Never** in ERP DB — vendor holds templates |
| OAuth refresh tokens | Encrypted blob + rotation audit |

---

## 4. Audit logs

| Event | Log destination |
|-------|-----------------|
| Raw event received | `attendance_raw_events` + optional `attendance_access_logs` |
| Summary change | `attendance_adjustments` (immutable) |
| Policy change | Policy version table or append-only log |
| Import completed | `import_jobs` + `communication_audit_logs` pattern |
| Integration failure | `attendance_sync_jobs` + notification |
| Download export | `report_access_logs` (P19) |

**Tamper evidence:** Raw events append-only; adjustments never DELETE.

---

## 5. Access control

| Role / permission | Capabilities |
|-------------------|--------------|
| Employee (self) | Clock self, view own events/summaries |
| `hr.manage` | Full workspace attendance admin |
| `reports.view` | Read reports only (existing P19) |
| Workspace admin | Integration config, locks, geofences |
| Platform super-admin | Break-glass with separate audit |

**Confidential documents:** Import files marked confidential follow `documentAccessService` rules.

---

## 6. Workspace isolation

- All queries filter `workspace_id` from auth context  
- Integration IDs cannot cross workspaces  
- Object storage keys include workspace prefix (existing pattern)  
- Normalization worker passes workspace from job row only  

---

## 7. Employee visibility rules

| Data | Employee | Manager | HR |
|------|----------|---------|-----|
| Own punches | Yes | No (unless policy) | Yes |
| Team punches | No | Optional team scope (future) | Yes |
| Location coordinates | Own only | Flagged summary | Full with permission |
| Import files | No | No | Yes |

---

## 8. Data retention

| Data class | Suggested retention |
|------------|---------------------|
| Raw events | 24 months |
| Normalized events | 24 months |
| Daily summaries | Life of employment + 7 years (jurisdiction-dependent) |
| Location on events | 12 months after day close |
| Sync job logs | 90 days |

Configurable per workspace in `attendance_policies` or workspace compliance settings (future).

---

## 9. Anti-tampering

| Threat | Mitigation |
|--------|------------|
| API replay | Idempotency keys + timestamp window |
| Webhook spoof | HMAC signature |
| HR backdating | Period locks; adjustment requires reason |
| Direct DB edit | Application-only writes; migrations controlled |
| Client clock manipulation | Server `received_at`; flag large skew |

---

## 10. Regulatory notes (non-exhaustive)

- **KSA PDPL / similar:** Purpose limitation for location; employee access rights  
- **Labor law recordkeeping:** Retain attendance evidence for inspection  
- Document legal review before enabling GPS in production  

---

## 11. Alignment with existing infra

| System | Use |
|--------|-----|
| P19 Document Registry | Import file storage, ACL |
| P19 Notifications | Alert on sync failure, import complete |
| P19 Reports | Export with access logs |
| Workspace SMTP | Optional compliance notifications |

---

## 12. Security gaps (current system)

1. No append-only event log  
2. Import overwrites without batch audit  
3. `source_type` can be set arbitrarily via API  
4. No period lock  
5. Location not collected yet — policy documents needed before enable  

---

**Implementation:** P20-B adds audit tables; P20-D adds location handling.
