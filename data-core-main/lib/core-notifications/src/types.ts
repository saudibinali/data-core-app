/**
 * @package @workspace/core-notifications
 * @purpose  Shared contracts for in-app and push notification delivery.
 *
 * Notifications are the user-visible surface of the event system.
 * Every notification is workspace-scoped and always targets a specific user.
 *
 * Ownership:  Platform Core — channel implementations (SSE, email, push)
 *             live in the api-server, but the payload shape is owned here.
 * Future:     Add delivery channel enum, read receipts per channel,
 *             notification preferences / do-not-disturb windows.
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

// ── Delivery channel ──────────────────────────────────────────────────────────

/**
 * NotificationChannel — where the notification is delivered.
 * "in_app" is the only production channel today (via SSE).
 * "email" is wired but gated on SMTP config.
 * "push" is a reserved placeholder.
 */
export type NotificationChannel = "in_app" | "email" | "push";

// ── Severity ──────────────────────────────────────────────────────────────────

export type NotificationSeverity = "info" | "success" | "warning" | "error";

// ── Core payload ──────────────────────────────────────────────────────────────

/**
 * NotificationPayload — everything needed to create a notification record
 * and dispatch it to the appropriate channel(s).
 */
export interface NotificationPayload {
  workspaceId: WorkspaceId;

  /** Recipient user ID. */
  userId: UserId;

  /** Short human-readable title shown in the notification center. */
  title: string;

  /** Optional longer body text. */
  body?: string;

  severity: NotificationSeverity;

  /** Deep-link within the platform, e.g. "/tickets/42". */
  actionUrl?: string;

  /** Which domain created this notification, e.g. "approvals", "hr". */
  sourceModule: string;

  /** ID of the source entity (e.g. ticket ID, approval ID). */
  sourceEntityId?: number;

  channels?: NotificationChannel[];
}

// ── Persisted record ──────────────────────────────────────────────────────────

/**
 * NotificationRecord — the stored shape after a NotificationPayload is written to DB.
 */
export interface NotificationRecord extends NotificationPayload {
  id: number;
  isRead: boolean;
  readAt?: ISOTimestamp;
  createdAt: ISOTimestamp;
}
