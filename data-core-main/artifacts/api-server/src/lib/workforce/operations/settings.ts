import { db } from "@workspace/db";
import { hrWorkspaceSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type WorkforceGovernanceMode = "legacy" | "shadow" | "active";

export type ActivationRequires = {
  orgUnit?: boolean;
  directManager?: boolean;
  employmentType?: boolean;
  jobTitle?: boolean;
};

const DEFAULT_ACTIVATION: ActivationRequires = {
  orgUnit: true,
  directManager: true,
  employmentType: true,
  jobTitle: false,
};

export async function getWorkforceGovernanceMode(
  workspaceId: number,
): Promise<WorkforceGovernanceMode> {
  try {
    const [row] = await db
      .select({ mode: hrWorkspaceSettingsTable.workforceGovernanceMode })
      .from(hrWorkspaceSettingsTable)
      .where(eq(hrWorkspaceSettingsTable.workspaceId, workspaceId));
    const mode = row?.mode ?? "legacy";
    if (mode === "shadow" || mode === "active") return mode;
    return "legacy";
  } catch {
    return "legacy";
  }
}

export async function getWorkforceActivationRequires(
  workspaceId: number,
): Promise<ActivationRequires> {
  try {
    const [row] = await db
      .select({ policy: hrWorkspaceSettingsTable.workforceActivationRequires })
      .from(hrWorkspaceSettingsTable)
      .where(eq(hrWorkspaceSettingsTable.workspaceId, workspaceId));
    const policy = row?.policy;
    if (policy && typeof policy === "object" && !Array.isArray(policy)) {
      return { ...DEFAULT_ACTIVATION, ...(policy as ActivationRequires) };
    }
    return DEFAULT_ACTIVATION;
  } catch {
    return DEFAULT_ACTIVATION;
  }
}
