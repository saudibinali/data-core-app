import { db } from "@workspace/db";
import { hrWorkspaceSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type LeaveRuntimeMode = "legacy" | "transition" | "canonical";

const VALID_MODES: LeaveRuntimeMode[] = ["legacy", "transition", "canonical"];

export function normalizeLeaveRuntimeMode(value: unknown): LeaveRuntimeMode {
  if (typeof value === "string" && VALID_MODES.includes(value as LeaveRuntimeMode)) {
    return value as LeaveRuntimeMode;
  }
  return "transition";
}

export async function getLeaveRuntimeMode(workspaceId: number): Promise<LeaveRuntimeMode> {
  const [row] = await db
    .select({ leaveRuntimeMode: hrWorkspaceSettingsTable.leaveRuntimeMode })
    .from(hrWorkspaceSettingsTable)
    .where(eq(hrWorkspaceSettingsTable.workspaceId, workspaceId));
  return normalizeLeaveRuntimeMode(row?.leaveRuntimeMode);
}

export async function getHcmWorkspaceSettings(workspaceId: number) {
  const [row] = await db
    .select()
    .from(hrWorkspaceSettingsTable)
    .where(eq(hrWorkspaceSettingsTable.workspaceId, workspaceId));
  return row ?? null;
}
