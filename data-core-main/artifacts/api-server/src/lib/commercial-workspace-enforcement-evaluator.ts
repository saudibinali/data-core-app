/**
 * @file   commercial-workspace-enforcement-evaluator.ts
 * @phase  P16-E - Advisory commercial workspace enforcement evaluation
 */

import { db } from "@workspace/db";
import {
  workspaceSubscriptionsTable,
  commercialContractTermsTable,
  commercialAccountsTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { DEFAULT_SUBSCRIPTION_POLICY } from "./subscription-policy-defaults";
import { evaluateSubscriptionPolicy } from "./workspace-subscription-policy-evaluator";
import type { SubscriptionPolicyFields } from "./subscription-policy-defaults";

export type WorkspaceEnforcementRecommendation =
  | "normal"
  | "read_only"
  | "suspended_view_only"
  | "terminated_view_only"
  | "review_required";

export interface CommercialWorkspaceEnforcementEvaluation {
  recommendation: WorkspaceEnforcementRecommendation;
  reasons: string[];
  subscriptionStatus: string | null;
  subscriptionId: number | null;
  policyEvaluation: ReturnType<typeof evaluateSubscriptionPolicy> | null;
  contractEndDate: string | null;
  commercialRiskLevel: string | null;
  manualApplyOnly: true;
  isAutomaticAllowed: false;
}

export async function evaluateCommercialWorkspaceEnforcement(
  tenantId: number,
): Promise<CommercialWorkspaceEnforcementEvaluation> {
  const reasons: string[] = [];

  const sub = await db.query.workspaceSubscriptionsTable.findFirst({
    where: eq(workspaceSubscriptionsTable.workspaceId, tenantId),
  });

  const policy: SubscriptionPolicyFields = { ...DEFAULT_SUBSCRIPTION_POLICY };

  let contractEndDate: string | null = null;
  const account = await db.query.commercialAccountsTable.findFirst({
    where: eq(commercialAccountsTable.workspaceId, tenantId),
  });
  if (account) {
    const [contract] = await db
        .select({ endDate: commercialContractTermsTable.endDate })
        .from(commercialContractTermsTable)
        .where(eq(commercialContractTermsTable.commercialAccountId, account.id))
        .orderBy(desc(commercialContractTermsTable.endDate))
        .limit(1);
      contractEndDate = contract?.endDate ?? null;
    if (contractEndDate) {
      reasons.push(`Latest contract end date: ${contractEndDate}.`);
    }
  }

  const policyEval = sub
    ? evaluateSubscriptionPolicy({
        subscription: { id: sub.id, status: sub.status, endDate: sub.endDate },
        policy,
      })
    : null;

  if (!sub) {
    reasons.push("No workspace subscription record.");
    return {
      recommendation: "review_required",
      reasons,
      subscriptionStatus: null,
      subscriptionId: null,
      policyEvaluation: null,
      contractEndDate,
      commercialRiskLevel: null,
      manualApplyOnly: true,
      isAutomaticAllowed: false,
    };
  }

  const status = sub.status;
  reasons.push(`Subscription status: ${status}.`);

  if (status === "archived") {
    reasons.push("Archived subscription requires manual review.");
    return {
      recommendation: "review_required",
      reasons,
      subscriptionStatus: status,
      subscriptionId: sub.id,
      policyEvaluation: policyEval,
      contractEndDate,
      commercialRiskLevel: null,
      manualApplyOnly: true,
      isAutomaticAllowed: false,
    };
  }

  if (status === "trial" || status === "active") {
    if (sub.endDate) {
      const pe = policyEval?.recommendedStatus;
      if (pe === "grace_period") {
        reasons.push("Within grace period after end date; default remains normal.");
        return {
          recommendation: "normal",
          reasons,
          subscriptionStatus: status,
          subscriptionId: sub.id,
          policyEvaluation: policyEval,
          contractEndDate,
          commercialRiskLevel: null,
          manualApplyOnly: true,
          isAutomaticAllowed: false,
        };
      }
    }
    return {
      recommendation: "normal",
      reasons,
      subscriptionStatus: status,
      subscriptionId: sub.id,
      policyEvaluation: policyEval,
      contractEndDate,
      commercialRiskLevel: null,
      manualApplyOnly: true,
      isAutomaticAllowed: false,
    };
  }

  if (status === "grace_period") {
    reasons.push("Grace period: default recommendation is normal (no auto read-only).");
    return {
      recommendation: "normal",
      reasons,
      subscriptionStatus: status,
      subscriptionId: sub.id,
      policyEvaluation: policyEval,
      contractEndDate,
      commercialRiskLevel: null,
      manualApplyOnly: true,
      isAutomaticAllowed: false,
    };
  }

  if (status === "past_due" || policyEval?.recommendedStatus === "past_due") {
    reasons.push("Past due: read-only recommended (manual apply only in P16-E).");
    return {
      recommendation: "read_only",
      reasons,
      subscriptionStatus: status,
      subscriptionId: sub.id,
      policyEvaluation: policyEval,
      contractEndDate,
      commercialRiskLevel: null,
      manualApplyOnly: true,
      isAutomaticAllowed: false,
    };
  }

  if (status === "suspended" || policyEval?.recommendedStatus === "suspended") {
    if (policy.allowReadOnlyDuringSuspension) {
      reasons.push("Suspended: view-only access (login allowed, writes blocked).");
    }
    return {
      recommendation: "suspended_view_only",
      reasons,
      subscriptionStatus: status,
      subscriptionId: sub.id,
      policyEvaluation: policyEval,
      contractEndDate,
      commercialRiskLevel: null,
      manualApplyOnly: true,
      isAutomaticAllowed: false,
    };
  }

  if (status === "terminated" || policyEval?.recommendedStatus === "terminated") {
    if (policy.allowReadOnlyDuringSuspension) {
      reasons.push("Terminated: view-only access (no data deletion).");
    }
    return {
      recommendation: "terminated_view_only",
      reasons,
      subscriptionStatus: status,
      subscriptionId: sub.id,
      policyEvaluation: policyEval,
      contractEndDate,
      commercialRiskLevel: null,
      manualApplyOnly: true,
      isAutomaticAllowed: false,
    };
  }

  reasons.push("Unable to map subscription state; manual review required.");
  return {
    recommendation: "review_required",
    reasons,
    subscriptionStatus: status,
    subscriptionId: sub.id,
    policyEvaluation: policyEval,
    contractEndDate,
    commercialRiskLevel: null,
    manualApplyOnly: true,
    isAutomaticAllowed: false,
  };
}
