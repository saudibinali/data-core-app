import { db } from "@workspace/db";
import { hrWorkspaceSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type CleanupStage = "none" | "stage1" | "stage2" | "stage3" | "stage4";

const STAGE_ORDER: CleanupStage[] = ["none", "stage1", "stage2", "stage3", "stage4"];

export type LegacyWriteSurface =
  | "departments"
  | "users.departmentId"
  | "users.lineManagerId"
  | "hr_employee_position_history"
  | "hr_employee_activity"
  | "approvals"
  | "workflow_approvals"
  | "leave_approval_steps"
  | "legacy_department_org_map";

export type LegacyWritePolicy = Partial<Record<LegacyWriteSurface, "allow" | "read_only" | "blocked">>;

export async function getWorkforceCleanupStage(workspaceId: number): Promise<CleanupStage> {
  try {
    const [row] = await db
      .select({ stage: hrWorkspaceSettingsTable.workforceCleanupStage })
      .from(hrWorkspaceSettingsTable)
      .where(eq(hrWorkspaceSettingsTable.workspaceId, workspaceId));
    const stage = row?.stage ?? "none";
    if (STAGE_ORDER.includes(stage as CleanupStage)) return stage as CleanupStage;
    return "none";
  } catch {
    return "none";
  }
}

export async function getLegacyWritePolicy(workspaceId: number): Promise<LegacyWritePolicy> {
  try {
    const [row] = await db
      .select({ policy: hrWorkspaceSettingsTable.legacyWritePolicy })
      .from(hrWorkspaceSettingsTable)
      .where(eq(hrWorkspaceSettingsTable.workspaceId, workspaceId));
    if (row?.policy && typeof row.policy === "object" && !Array.isArray(row.policy)) {
      return row.policy as LegacyWritePolicy;
    }
  } catch {
    /* default */
  }
  return {};
}

function defaultPolicyForStage(stage: CleanupStage, surface: LegacyWriteSurface): "allow" | "read_only" | "blocked" {
  if (stage === "none") return "allow";
  if (stage === "stage1") return "read_only";
  if (stage === "stage2") return "read_only";
  if (stage === "stage3") return "blocked";
  return "blocked";
}

export async function resolveLegacyWritePolicy(
  workspaceId: number,
  surface: LegacyWriteSurface,
): Promise<"allow" | "read_only" | "blocked"> {
  const stage = await getWorkforceCleanupStage(workspaceId);
  const overrides = await getLegacyWritePolicy(workspaceId);
  return overrides[surface] ?? defaultPolicyForStage(stage, surface);
}

export type LegacyWriteCheckResult =
  | { ok: true }
  | { ok: false; status: number; error: string; code: string };

export async function assertLegacyWriteAllowed(
  workspaceId: number,
  surface: LegacyWriteSurface,
  sourcePath?: string,
): Promise<LegacyWriteCheckResult> {
  const policy = await resolveLegacyWritePolicy(workspaceId, surface);
  if (policy === "allow") return { ok: true };

  if (policy === "read_only") {
    return {
      ok: false,
      status: 409,
      error: `Legacy write blocked (${surface}): cleanup stage active — read compatibility only`,
      code: "LEGACY_WRITE_DISABLED_STAGE1",
    };
  }

  return {
    ok: false,
    status: 409,
    error: `Legacy write blocked (${surface}): cleanup stage3+ — adapter removal in progress`,
    code: "LEGACY_WRITE_DISABLED_STAGE3",
  };
}

/** Stage 3+ disables compatibility adapter side-effects (no code deletion). */
export async function shouldRunLegacyAdapter(
  workspaceId: number,
  adapter: "sync_user_fields" | "position_history_mirror" | "leave_dual_write",
): Promise<boolean> {
  const stage = await getWorkforceCleanupStage(workspaceId);
  if (stage === "none" || stage === "stage1" || stage === "stage2") return true;
  if (adapter === "leave_dual_write") return stage !== "stage3" && stage !== "stage4";
  return false;
}

export function isStageAtLeast(current: CleanupStage, minimum: CleanupStage): boolean {
  return STAGE_ORDER.indexOf(current) >= STAGE_ORDER.indexOf(minimum);
}
