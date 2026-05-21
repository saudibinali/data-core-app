export interface EventPayload {
  event: string;
  module: string;
  workspaceId: number;
  triggeredBy?: number;
  data: Record<string, unknown>;
}

export type EventListener = (
  payload: EventPayload,
  logId: number,
) => Promise<void>;

// ── Well-known event names ────────────────────────────────────────────────────

export const EVENTS = {
  // Employees / Users
  EMPLOYEE_CREATED:  "employee.created",
  EMPLOYEE_UPDATED:  "employee.updated",
  EMPLOYEE_DELETED:  "employee.deleted",
  EMPLOYEE_RESIGNED: "employee.resigned",

  // Tickets
  TICKET_CREATED:    "ticket.created",
  TICKET_UPDATED:    "ticket.updated",
  TICKET_CLOSED:     "ticket.closed",
  TICKET_COMMENTED:  "ticket.commented",

  // Approvals
  APPROVAL_REQUESTED: "approval.requested",
  APPROVAL_APPROVED:  "approval.approved",
  APPROVAL_REJECTED:  "approval.rejected",

  // Departments
  DEPARTMENT_CREATED: "department.created",
  DEPARTMENT_UPDATED: "department.updated",

  // Groups
  GROUP_CREATED:      "group.created",
  GROUP_MEMBER_ADDED: "group.member_added",

  // Leave
  LEAVE_REQUESTED: "leave.requested",
  LEAVE_APPROVED:  "leave.approved",
  LEAVE_REJECTED:  "leave.rejected",

  // Calendar
  MEETING_CREATED: "meeting.created",
  MEETING_UPDATED: "meeting.updated",

  // System
  USER_LOGGED_IN: "user.logged_in",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
