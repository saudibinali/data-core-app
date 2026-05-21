import { logger } from "../logger";

export type AttendanceAccessLogInput = {
  workspaceId: number;
  userId?: number;
  action: string;
  resourceType: string;
  resourceId?: number;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
};

/** Hook for access auditing (structured log until dedicated table in later phase). */
export function logAttendanceAccess(input: AttendanceAccessLogInput): void {
  logger.info(
    {
      workspaceId: input.workspaceId,
      userId: input.userId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      ip: input.ipAddress,
      metadata: input.metadata,
    },
    "[workforce] access",
  );
}
