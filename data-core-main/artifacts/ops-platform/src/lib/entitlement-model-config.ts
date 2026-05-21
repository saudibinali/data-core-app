/**
 * @file   entitlement-model-config.ts
 * @phase  P16-B - Entitlement & Feature Access Model
 */

export const ENTITLEMENT_MODEL_SAFETY_CONTRACT = {
  entitlementModelOnly: true,
  noBroadEnforcement: true,
  noTenantLoginBlocking: true,
  noAutomaticSuspension: true,
  noElectronicPayment: true,
  noStripe: true,
  noCheckout: true,
  noPaymentGateway: true,
  noInvoiceGenerationEngine: true,
  noTaxCalculation: true,
  noZatcaIntegration: true,
  noAccountingLedger: true,
  noEmailSending: true,
  noDestructiveWorkspaceActions: true,
  noCustomPermissions: true,
  coreModuleAlwaysEnabled: true,
  permissionGated: true,
  auditEntitlementChanges: true,
} as const satisfies Record<string, true>;

void (() => {
  for (const [key, value] of Object.entries(ENTITLEMENT_MODEL_SAFETY_CONTRACT)) {
    if (value !== true) {
      throw new Error(`ENTITLEMENT_MODEL_SAFETY_CONTRACT violated: ${key} must be true`);
    }
  }
})();

export const ENTITLEMENT_SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  subscription_plan: "Subscription plan",
  contract_override: "Contract override",
  trial: "Trial",
  system_default: "System default",
};
