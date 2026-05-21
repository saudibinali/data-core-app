/**
 * P20-B — Minimal attendance event → notification hooks
 */
import { EVENT_TYPES } from "@workspace/core-events";
import { appEventBus } from "../app-bus";
import { dispatchUserNotification } from "../../notifications/dispatch";
import { db } from "@workspace/db";
import { employeesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../../logger";

appEventBus.subscribe(EVENT_TYPES.ATTENDANCE_DAY_CALCULATED, async (event) => {
  const { employeeId, localDate, status } = event.data;
  const workspaceId = event.workspace.workspaceId;

  const [emp] = await db
    .select({ userId: employeesTable.userId, fullName: employeesTable.fullName })
    .from(employeesTable)
    .where(eq(employeesTable.id, employeeId))
    .limit(1);

  if (!emp?.userId) return;

  await dispatchUserNotification({
    workspaceId,
    userId: emp.userId,
    type: "attendance_day_calculated",
    title: "Attendance updated",
    message: `Your attendance for ${localDate} was recorded (${status}).`,
    enqueueEmail: false,
  });
});

appEventBus.subscribe(EVENT_TYPES.ATTENDANCE_RAW_RECEIVED, async (event) => {
  if (!event.data.duplicate) return;
  logger.debug({ rawEventId: event.data.rawEventId }, "[attendance-bus] duplicate raw skipped");
});

/** Side-effect registration marker (import from events/index.ts). */
export function registerAttendanceBusListeners(): void {
  /* listeners registered at module load */
}
