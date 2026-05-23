import { db } from "@workspace/db";
import { hrWorkspaceSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { WorkforceCanonicalMode, WorkforceSyncDirection } from "./types";

const VALID_MODES: WorkforceCanonicalMode[] = ["legacy", "shadow", "active"];
const VALID_SYNC: WorkforceSyncDirection[] = ["none", "employee_to_user", "bidirectional"];

export function normalizeWorkforceCanonicalMode(value: unknown): WorkforceCanonicalMode {
  if (typeof value === "string" && VALID_MODES.includes(value as WorkforceCanonicalMode)) {
    return value as WorkforceCanonicalMode;
  }
  return "legacy";
}

export function normalizeWorkforceSyncDirection(value: unknown): WorkforceSyncDirection {
  if (typeof value === "string" && VALID_SYNC.includes(value as WorkforceSyncDirection)) {
    return value as WorkforceSyncDirection;
  }
  return "none";
}

export type WorkforceWorkspaceSettings = {
  workforceCanonicalMode: WorkforceCanonicalMode;
  workforceSyncDirection: WorkforceSyncDirection;
};

export async function getWorkforceWorkspaceSettings(
  workspaceId: number,
): Promise<WorkforceWorkspaceSettings> {
  try {
    const [row] = await db
      .select({
        workforceCanonicalMode: hrWorkspaceSettingsTable.workforceCanonicalMode,
        workforceSyncDirection: hrWorkspaceSettingsTable.workforceSyncDirection,
      })
      .from(hrWorkspaceSettingsTable)
      .where(eq(hrWorkspaceSettingsTable.workspaceId, workspaceId));

    return {
      workforceCanonicalMode: normalizeWorkforceCanonicalMode(row?.workforceCanonicalMode),
      workforceSyncDirection: normalizeWorkforceSyncDirection(row?.workforceSyncDirection),
    };
  } catch {
    return { workforceCanonicalMode: "legacy", workforceSyncDirection: "none" };
  }
}

export function shouldSyncEmployeeToUser(direction: WorkforceSyncDirection): boolean {
  return direction === "employee_to_user" || direction === "bidirectional";
}
