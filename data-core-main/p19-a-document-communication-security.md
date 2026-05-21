# P19-A — Document & Communication Security

**Date:** 2026-05-19  
**Type:** Architecture foundation only.

---

## 1. Threat model (summary)

| Threat | Mitigation |
|--------|------------|
| Cross-workspace file access | `workspace_id` on all queries; signed URLs bind workspace |
| Unauthenticated upload | **Gap today** — presign must require auth + workspace |
| Malware in uploads | Async virus scan before `active` status |
| MIME spoofing | Magic-byte check + allowlist |
| PII leakage via export | Permission + audit + export policy flags |
| SMTP credential theft | Encryption at rest; KMS optional |
| Email injection | Template escaping; no raw HTML from users |

---

## 2. File validation

| Check | When |
|-------|------|
| Max size | Presign request (e.g. 25 MB default, 100 MB report) |
| Allowlist MIME | `application/pdf`, `image/*`, `application/vnd.openxmlformats-*` |
| Extension vs MIME | Reject mismatch |
| Filename sanitization | Strip `..`, null bytes |
| Empty file | Reject |

---

## 3. Malware scanning strategy

| Phase | Approach |
|-------|----------|
| P19-B | Hook interface; optional ClamAV sidecar |
| P19-C | Cloud AV (GCS Object finalize trigger) |
| Block | `documents.status = quarantined` until clean |

---

## 4. MIME validation

- Server reads first bytes after upload complete (callback/webhook)
- Reject executables (`application/x-msdownload`, etc.)
- ZIP bombs: limit uncompressed size on parse for imports

---

## 5. Signed URLs

| Use | TTL | Constraints |
|-----|-----|-------------|
| Download | 15 min | Single `document_id` + `version` |
| Upload presign | 10 min | Content-Type + max size in policy |
| Report download | 15 min | `generated_reports.id` |

**Never:** Long-lived public URLs for confidential HR docs.

**Gap today:** `storage.ts` private object GET has ACL checks **commented out**.

---

## 6. Access control

| Layer | Mechanism |
|-------|-----------|
| API | `requireAuth` + `requirePermission` |
| Document | Row-level: owner, HR role, manager of employee |
| Export | `allow_export` + domain permissions |
| Platform admin | Separate platform routes; no workspace doc access without impersonation audit |

---

## 7. Retention

| Data | Default retention |
|------|-------------------|
| `communication_audit_logs` | 7 years |
| `document_access_logs` | 7 years |
| `generated_reports` | 90 days |
| `import_jobs` source files | 1 year |
| Deleted documents | 30 day soft-delete → purge |

Legal hold: flag on `documents` blocks purge.

---

## 8. Encryption

| Layer | Approach |
|-------|----------|
| At rest | Cloud provider default (GCS/S3 SSE) |
| SMTP secrets | App-level encryption (AES-256-GCM) |
| In transit | TLS 1.2+ everywhere |
| End-to-end | Not in scope |

---

## 9. Audit logs

| Log | Events |
|-----|--------|
| `document_access_logs` | view, download, export, delete |
| `communication_audit_logs` | email sent, template changed, SMTP tested |
| Existing | `workspace_event_logs` + `bus_event_id` correlation |

---

## 10. Export authorization

Checklist (see reporting arch):

1. User in workspace
2. Permission
3. `workspace_access_enforcement.allow_export`
4. Subscription suspension policy
5. Audit log on download

---

## 11. Download tracking

- Every signed URL redemption logs `document_access_logs`
- Optional: one-time tokens (`used_at`)

---

## 12. PII handling

| Data | Rule |
|------|------|
| National ID in HR docs | Classification `confidential`; mask in logs |
| Email addresses | Hash in delivery logs optional |
| Export files | Watermark with requester id + timestamp (PDF phase 2) |
| Right to erasure | Purge documents + anonymize audit actor where legal |

---

## 13. Compliance alignment

- GDPR-ready audit and retention hooks
- SOC2: access logging + least privilege
- Regional data residency: future `workspace.storage_region`

---

**Confirmation:** Security architecture only; no scanners deployed in P19-A.
