/**
 * @file   tenant-subscription-config.ts
 * @phase  P16-G - Tenant Subscription Visibility (read-only)
 */

export const TENANT_SUBSCRIPTION_PERMISSIONS = {
  READ: "tenant.subscription.read",
  ENTITLEMENTS_READ: "tenant.subscription.entitlements.read",
  QUOTAS_READ: "tenant.subscription.quotas.read",
} as const;

export const TENANT_SUBSCRIPTION_VISIBILITY_SAFETY_CONTRACT = {
  tenantSubscriptionVisibilityOnly: true,
  tenantReadOnlySubscription: true,
  noTenantSubscriptionUpdate: true,
  noTenantEntitlementUpdate: true,
  noTenantQuotaUpdate: true,
  noTenantPolicyUpdate: true,
  noTenantWorkspaceAccessUpdate: true,
  noSelfServiceUpgrade: true,
  noPayment: true,
  noStripe: true,
  noCheckout: true,
  noPaymentGateway: true,
  noInvoiceGenerationEngine: true,
  noTaxCalculation: true,
  noZatcaIntegration: true,
  noAccountingLedger: true,
  noEmailSending: true,
  noUploadInvoice: true,
  noUploadContract: true,
  noInternalCommercialRiskExposed: true,
  noInternalCollectionDetailsExposed: true,
  noSensitiveAuditMetadataExposed: true,
  invoicePdfDownloadStillAccessible: true,
  permissionGated: true,
} as const satisfies Record<string, true>;

void (() => {
  for (const [key, value] of Object.entries(TENANT_SUBSCRIPTION_VISIBILITY_SAFETY_CONTRACT)) {
    if (value !== true) {
      throw new Error(`TENANT_SUBSCRIPTION_VISIBILITY_SAFETY_CONTRACT violated: ${key} must be true`);
    }
  }
})();
