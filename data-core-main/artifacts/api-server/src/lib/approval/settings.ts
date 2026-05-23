import { db } from "@workspace/db";
import { hrWorkspaceSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { ApprovalRuntimeMode } from "./types";

const VALID: ApprovalRuntimeMode[] = ["legacy", "dual", "unified"];

export function normalizeApprovalRuntimeMode(value: unknown): ApprovalRuntimeMode {
  if (typeof value === "string" && VALID.includes(value as ApprovalRuntimeMode)) {
    return value as ApprovalRuntimeMode;
  }
  return "legacy";
}

export async function getApprovalRuntimeMode(workspaceId: number): Promise<ApprovalRuntimeMode> {
  try {
    const [row] = await db
      .select({ approvalRuntimeMode: hrWorkspaceSettingsTable.approvalRuntimeMode })
      .from(hrWorkspaceSettingsTable)
      .where(eq(hrWorkspaceSettingsTable.workspaceId, workspaceId));
    return normalizeApprovalRuntimeMode(row?.approvalRuntimeMode);
  } catch {
    return "legacy";
  }
}

export function usesUnifiedApproval(mode: ApprovalRuntimeMode): boolean {
  return mode === "dual" || mode === "unified";
}
