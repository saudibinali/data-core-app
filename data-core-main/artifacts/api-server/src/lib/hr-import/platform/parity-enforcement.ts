/**
 * Final Phase — Parity enforcement runtime.
 */

import { PARITY_THRESHOLD, computeWorkspaceParityScore, computeWorkspaceReadiness } from "./readiness-service";
import { compareLegacyVsShadowRow, summarizeShadowComparison } from "../validation/shadow-validation";
import { incrementRuntimeMetric } from "../../workforce/stabilization/observability-metrics";

export type ParityEnforcementResult = {
  parityScore: number;
  fieldLevelScore: number;
  commitParityScore: number;
  threshold: number;
  activationBlocked: boolean;
  enforcementEnabled: boolean;
  diagnostics: Record<string, unknown>;
};

export async function enforceParityThreshold(workspaceId: number, sessionId?: number): Promise<ParityEnforcementResult> {
  const scores = await computeWorkspaceParityScore(workspaceId, sessionId);
  const readiness = await computeWorkspaceReadiness(workspaceId);

  const activationBlocked = scores.parityScore < PARITY_THRESHOLD;
  if (activationBlocked) incrementRuntimeMetric("import.final.parity_blocked");

  return {
    parityScore: scores.parityScore,
    fieldLevelScore: scores.fieldLevelScore,
    commitParityScore: scores.commitParityScore,
    threshold: PARITY_THRESHOLD,
    activationBlocked,
    enforcementEnabled: true,
    diagnostics: {
      readinessScore: readiness.readinessScore,
      blockers: readiness.blockers,
      validationParity: scores.report?.validationParity,
      commitParity: scores.report?.commitParity,
      fieldMismatches: scores.report?.fieldMismatches?.length ?? 0,
    },
  };
}

export function scoreFieldLevelParity(
  comparisons: ReturnType<typeof compareLegacyVsShadowRow>[],
): number {
  const summary = summarizeShadowComparison(comparisons);
  return summary.parityRatio;
}
