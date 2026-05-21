/**
 * @file   subscription-policy-defaults.ts
 * @phase  P16-D - Grace Period & Suspension Rules
 */

export const SUBSCRIPTION_POLICY_ENFORCEMENT_MODES = [
  "advisory_only",
  "manual_required",
  "automatic_recommended",
] as const;

export type SubscriptionPolicyEnforcementMode =
  (typeof SUBSCRIPTION_POLICY_ENFORCEMENT_MODES)[number];

export const DEFAULT_SUBSCRIPTION_POLICY = {
  policyName: "Default grace & suspension policy",
  gracePeriodDays: 7,
  pastDueAfterDays: 14,
  suspensionAfterDays: 30,
  terminationAfterDays: 90 as number | null,
  allowReadOnlyDuringSuspension: true,
  allowAdminAccessDuringSuspension: true,
  allowDataExportDuringSuspension: true,
  enforcementMode: "advisory_only" as SubscriptionPolicyEnforcementMode,
  isActive: true,
};

export function isSubscriptionPolicyEnforcementMode(
  v: string,
): v is SubscriptionPolicyEnforcementMode {
  return (SUBSCRIPTION_POLICY_ENFORCEMENT_MODES as readonly string[]).includes(v);
}

export interface SubscriptionPolicyFields {
  policyName: string;
  gracePeriodDays: number;
  pastDueAfterDays: number;
  suspensionAfterDays: number;
  terminationAfterDays: number | null;
  allowReadOnlyDuringSuspension: boolean;
  allowAdminAccessDuringSuspension: boolean;
  allowDataExportDuringSuspension: boolean;
  enforcementMode: SubscriptionPolicyEnforcementMode;
  isActive: boolean;
}

export function validatePolicyDayOrdering(
  input: SubscriptionPolicyFields,
): string | null {
  if (input.gracePeriodDays < 0) return "gracePeriodDays must be >= 0";
  if (input.pastDueAfterDays < input.gracePeriodDays) {
    return "pastDueAfterDays must be >= gracePeriodDays";
  }
  if (input.suspensionAfterDays < input.pastDueAfterDays) {
    return "suspensionAfterDays must be >= pastDueAfterDays";
  }
  if (
    input.terminationAfterDays != null &&
    input.terminationAfterDays < input.suspensionAfterDays
  ) {
    return "terminationAfterDays must be >= suspensionAfterDays when set";
  }
  return null;
}
