/**
 * P20-E — Integration sync / disable → notifications
 */
import { EVENT_TYPES } from "@workspace/core-events";
import { appEventBus } from "../app-bus";
import { dispatchUserNotification } from "../../notifications/dispatch";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

async function notifyHrAdmins(
  workspaceId: number,
  type: string,
  title: string,
  message: string,
): Promise<void> {
  const admins = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.workspaceId, workspaceId),
        inArray(usersTable.role, ["admin", "owner"]),
      ),
    );

  for (const admin of admins) {
    await dispatchUserNotification({
      workspaceId,
      userId: admin.id,
      type,
      title,
      message,
      enqueueEmail: type === "attendance_sync_failed",
    });
  }
}

appEventBus.subscribe(EVENT_TYPES.ATTENDANCE_SYNC_FAILED, async (event) => {
  const { name, error } = event.data;
  await notifyHrAdmins(
    event.workspace.workspaceId,
    "attendance_sync_failed",
    "Attendance sync failed",
    `Integration "${name}" failed: ${error}`,
  );
});

appEventBus.subscribe(EVENT_TYPES.ATTENDANCE_SYNC_COMPLETED, async (event) => {
  const { name, ingested, failed } = event.data;
  if (failed > 0) {
    await notifyHrAdmins(
      event.workspace.workspaceId,
      "attendance_sync_completed",
      "Attendance sync completed with errors",
      `Integration "${name}": ${ingested} ingested, ${failed} failed.`,
    );
  }
});

appEventBus.subscribe(EVENT_TYPES.ATTENDANCE_INTEGRATION_DISABLED, async (event) => {
  const { name } = event.data;
  await notifyHrAdmins(
    event.workspace.workspaceId,
    "attendance_integration_disabled",
    "Attendance integration disabled",
    `Integration "${name}" was disabled.`,
  );
});

export function registerIntegrationBusListeners(): void {
  /* side-effect registration */
}
