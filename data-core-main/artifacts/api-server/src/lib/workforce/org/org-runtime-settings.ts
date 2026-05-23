import { db } from "@workspace/db";
import { hrWorkspaceSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type OrgRuntimeMode = "legacy" | "shadow" | "active";

const VALID: OrgRuntimeMode[] = ["legacy", "shadow", "active"];

export function normalizeOrgRuntimeMode(value: unknown): OrgRuntimeMode {
  if (typeof value === "string" && VALID.includes(value as OrgRuntimeMode)) {
    return value as OrgRuntimeMode;
  }
  return "legacy";
}

export async function getOrgRuntimeMode(workspaceId: number): Promise<OrgRuntimeMode> {
  try {
    const [row] = await db
      .select({ orgRuntimeMode: hrWorkspaceSettingsTable.orgRuntimeMode })
      .from(hrWorkspaceSettingsTable)
      .where(eq(hrWorkspaceSettingsTable.workspaceId, workspaceId));
    return normalizeOrgRuntimeMode(row?.orgRuntimeMode);
  } catch {
    return "legacy";
  }
}
