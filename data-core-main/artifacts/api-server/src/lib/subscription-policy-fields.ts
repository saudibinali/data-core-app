/**
 * Shared policy field extraction from DB row (P16-D/P16-E).
 */

import { workspaceSubscriptionPoliciesTable } from "@workspace/db";
import {
  DEFAULT_SUBSCRIPTION_POLICY,
  isSubscriptionPolicyEnforcementMode,
  type SubscriptionPolicyFields,
} from "./subscription-policy-defaults";

export function policyFieldsFromRow(
  row: typeof workspaceSubscriptionPoliciesTable.$inferSelect,
): SubscriptionPolicyFields {
  return {
    policyName: row.policyName,
    gracePeriodDays: row.gracePeriodDays,
    pastDueAfterDays: row.pastDueAfterDays,
    suspensionAfterDays: row.suspensionAfterDays,
    terminationAfterDays: row.terminationAfterDays,
    allowReadOnlyDuringSuspension: row.allowReadOnlyDuringSuspension,
    allowAdminAccessDuringSuspension: row.allowAdminAccessDuringSuspension,
    allowDataExportDuringSuspension: row.allowDataExportDuringSuspension,
    enforcementMode: isSubscriptionPolicyEnforcementMode(row.enforcementMode)
      ? row.enforcementMode
      : "advisory_only",
    isActive: row.isActive,
  };
}

export function policyFieldsFromRowOrDefault(
  row: typeof workspaceSubscriptionPoliciesTable.$inferSelect | undefined,
): SubscriptionPolicyFields {
  if (!row) return { ...DEFAULT_SUBSCRIPTION_POLICY };
  return policyFieldsFromRow(row);
}
