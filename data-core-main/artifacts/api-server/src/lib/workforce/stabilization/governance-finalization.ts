import { db } from "@workspace/db";
import { legacyCutoverSnapshotTable } from "@workspace/db";
import { getWorkforceCleanupStage } from "./cleanup-staging";
import { getLegacyUsageSummary, hasZeroActiveLegacyTraffic } from "./usage-telemetry";
import { getWorkspaceCutoverModes } from "./runtime-health-service";

export type CutoverReadinessCheck = {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
};

export async function getGovernanceCutoverReadiness(workspaceId: number): Promise<{
  readyForActiveGovernance: boolean;
  readyForCleanupStage1: boolean;
  checks: CutoverReadinessCheck[];
}> {
  const modes = await getWorkspaceCutoverModes(workspaceId);
  const usage = await getLegacyUsageSummary(workspaceId, 30);
  const zeroTraffic = await hasZeroActiveLegacyTraffic(workspaceId, 30);
  const stage = await getWorkforceCleanupStage(workspaceId);

  const checks: CutoverReadinessCheck[] = [
    {
      id: "org_active",
      label: "Org runtime active",
      passed: modes.orgRuntimeMode === "active",
      detail: `orgRuntimeMode=${modes.orgRuntimeMode}`,
    },
    {
      id: "approval_unified_or_dual",
      label: "Approval runtime dual/unified",
      passed: modes.approvalRuntimeMode === "dual" || modes.approvalRuntimeMode === "unified",
      detail: `approvalRuntimeMode=${modes.approvalRuntimeMode}`,
    },
    {
      id: "governance_shadow_or_active",
      label: "Governance shadow/active",
      passed: modes.workforceGovernanceMode === "shadow" || modes.workforceGovernanceMode === "active",
      detail: `workforceGovernanceMode=${modes.workforceGovernanceMode}`,
    },
    {
      id: "zero_legacy_traffic_30d",
      label: "Zero legacy route/adapter writes (30d)",
      passed: zeroTraffic,
      detail: `totalEvents=${usage.total}`,
    },
    {
      id: "cleanup_stage_none",
      label: "Cleanup not started (safe baseline)",
      passed: stage === "none",
      detail: `workforceCleanupStage=${stage}`,
    },
  ];

  const readyForActiveGovernance =
    modes.orgRuntimeMode === "active"
    && (modes.approvalRuntimeMode === "dual" || modes.approvalRuntimeMode === "unified")
    && modes.workforceGovernanceMode !== "legacy";

  const readyForCleanupStage1 =
    readyForActiveGovernance
    && zeroTraffic
    && stage === "none";

  return { readyForActiveGovernance, readyForCleanupStage1, checks };
}

export async function upsertDailyCutoverSnapshot(workspaceId: number): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const modes = await getWorkspaceCutoverModes(workspaceId);
  const usage = await getLegacyUsageSummary(workspaceId, 1);
  const stage = await getWorkforceCleanupStage(workspaceId);

  await db
    .insert(legacyCutoverSnapshotTable)
    .values({
      workspaceId,
      snapshotDate: today,
      modes,
      legacyHits: usage.bySurface,
      cleanupStage: stage,
      integrity: { zeroActiveLegacyTraffic: usage.total === 0 },
    })
    .onConflictDoUpdate({
      target: [legacyCutoverSnapshotTable.workspaceId, legacyCutoverSnapshotTable.snapshotDate],
      set: {
        modes,
        legacyHits: usage.bySurface,
        cleanupStage: stage,
        integrity: { zeroActiveLegacyTraffic: usage.total === 0 },
      },
    })
    .catch(() => undefined);
}
