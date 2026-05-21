/**
 * @workspace/core-notifications
 *
 * Public surface of the core-notifications package.
 * Export only the types that cross package boundaries.
 * Do NOT export runtime implementations from here.
 */

export type {
  NotificationChannel,
  NotificationSeverity,
  NotificationPayload,
  NotificationRecord,
} from "./types";
