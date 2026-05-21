/**
 * @package @workspace/core-audit
 * @purpose  Immutable audit trail contracts for all state-changing operations.
 *
 * Every write that changes business-critical state should produce an AuditRecord.
 * The audit log is append-only — no records are ever deleted or updated.
 *
 * Ownership:  Platform Core — individual modules emit audit entries
 *             but must conform to this package's schema.
 * Future:     Add structured diff (before/after), retention policies,
 *             compliance export (CSV/PDF), and per-workspace audit settings.
 *
 * Note on primitives: re-declared locally for package independence.
 * Future: import from @workspace/core-events once proper project references are added.
 */

// ── Shared primitives (re-declared for package independence) ──────────────────

/** ISO-8601 timestamp string. */
export type ISOTimestamp = string;

/** Opaque workspace identifier. */
export type WorkspaceId = number;

/** Opaque user identifier. Undefined for system-generated actions. */
export type UserId = number | undefined;

// ── Action classification ─────────────────────────────────────────────────────

/**
 * AuditAction — the category of state change.
 *
 * Keeps consistent vocabulary across all modules.
 * Do NOT use free-form strings — always extend this union.
 */
export type AuditAction =
  | "created"
  | "updated"
  | "deleted"
  | "status_changed"
  | "assigned"
  | "approved"
  | "rejected"
  | "invited"
  | "login"
  | "logout"
  | "password_changed"
  | "permission_changed"
  | "exported";

// ── Entity reference ──────────────────────────────────────────────────────────

/**
 * AuditEntityRef — identifies the entity that was acted upon.
 */
export interface AuditEntityRef {
  /** Domain type: "ticket", "user", "workspace", "hr.employee", etc. */
  entityType: string;
  entityId: number;
  /** Human-readable label captured at write time (stable even if entity is later deleted). */
  entityLabel?: string;
}

// ── Audit record ──────────────────────────────────────────────────────────────

/**
 * AuditRecord — a single immutable entry in the audit log.
 *
 * Future: add `diff: { before: unknown; after: unknown }` for field-level changes.
 */
export interface AuditRecord {
  id: number;
  workspaceId: WorkspaceId;

  /** User who performed the action. Null for system/automated actions. */
  actorId: UserId;

  action: AuditAction;
  entity: AuditEntityRef;

  /** Free-form additional context (kept as unknown to allow any shape). */
  metadata?: Record<string, unknown>;

  /** Client IP captured for security-sensitive actions. */
  ipAddress?: string;

  occurredAt: ISOTimestamp;
}

// ── Emit request ──────────────────────────────────────────────────────────────

/**
 * AuditEmitRequest — what a caller passes to emit an audit entry.
 * `id` and `occurredAt` are assigned by the audit service.
 */
export type AuditEmitRequest = Omit<AuditRecord, "id" | "occurredAt">;
