/**
 * P20-F — Operational alert notifications (HR admins)
 */
import { dispatchUserNotification } from "../notifications/dispatch";
import { db, usersTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import type { WorkforceAlert } from "./operations-service";

async function notifyAdmins(
  workspaceId: number,
  type: string,
  title: string,
  message: string,
  enqueueEmail: boolean,
): Promise<void> {
  const admins = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      and(eq(usersTable.workspaceId, workspaceId), inArray(usersTable.role, ["admin", "owner"])),
    );
  for (const admin of admins) {
    await dispatchUserNotification({
      workspaceId,
      userId: admin.id,
      type,
      title,
      message,
      enqueueEmail,
    });
  }
}

const sentCache = new Map<string, number>();
const COOLDOWN_MS = 60 * 60 * 1000;

function shouldSend(workspaceId: number, code: string): boolean {
  const key = `${workspaceId}:${code}`;
  const last = sentCache.get(key) ?? 0;
  if (Date.now() - last < COOLDOWN_MS) return false;
  sentCache.set(key, Date.now());
  return true;
}

export async function dispatchOperationalAlerts(
  workspaceId: number,
  alerts: WorkforceAlert[],
): Promise<void> {
  for (const alert of alerts) {
    if (alert.severity === "info") continue;
    if (!shouldSend(workspaceId, alert.code)) continue;

    await notifyAdmins(
      workspaceId,
      `workforce_ops_${alert.code}`,
      alert.title,
      alert.message,
      alert.severity === "critical",
    );
  }
}
