/**
 * @file   workspace-access-enforcement-config.ts
 * @phase  P16-E - Commercial-to-Workspace Enforcement
 */

export const WORKSPACE_ACCESS_ENFORCEMENT_SAFETY_CONTRACT = {
  readOnlyAfterSubscriptionEnd: true,
  allowLoginInReadOnly: true,
  allowReadInReadOnly: true,
  blockCreateInReadOnly: true,
  blockUpdateInReadOnly: true,
  blockDeleteInReadOnly: true,
  noFullLoginBlockingByDefault: true,
  noDataDeletion: true,
  noDestructiveWorkspaceActions: true,
  manualApplyOnly: true,
  noAutomaticEnforcement: true,
  platformRoutesExempt: true,
  tenantBillingReadOnlyStillAccessible: true,
  invoicePdfDownloadStillAccessible: true,
  noElectronicPayment: true,
  noStripe: true,
  noCheckout: true,
  noPaymentGateway: true,
  noInvoiceGenerationEngine: true,
  noTaxCalculation: true,
  noZatcaIntegration: true,
  noAccountingLedger: true,
  noEmailSending: true,
  noAutomatedDunning: true,
  noAutomatedRenewalActions: true,
  noCustomPermissions: true,
  permissionGated: true,
  auditWorkspaceAccessChanges: true,
  auditBlockedWrites: true,
} as const satisfies Record<string, true>;

void (() => {
  for (const [key, value] of Object.entries(WORKSPACE_ACCESS_ENFORCEMENT_SAFETY_CONTRACT)) {
    if (value !== true) {
      throw new Error(`WORKSPACE_ACCESS_ENFORCEMENT_SAFETY_CONTRACT violated: ${key} must be true`);
    }
  }
})();

export const READ_ONLY_ENFORCEMENT_STATUSES = new Set([
  "read_only",
  "suspended_view_only",
  "terminated_view_only",
  "restricted",
]);

export function isWorkspaceReadOnlyStatus(status: string): boolean {
  return READ_ONLY_ENFORCEMENT_STATUSES.has(status);
}

export const ENFORCEMENT_STATUS_LABELS: Record<string, { label: string; labelAr: string }> = {
  normal: { label: "Normal", labelAr: "عادي" },
  read_only: { label: "Read-only", labelAr: "قراءة فقط" },
  restricted: { label: "Restricted", labelAr: "مقيد" },
  suspended_view_only: { label: "Suspended (view only)", labelAr: "معلق - عرض فقط" },
  terminated_view_only: { label: "Terminated (view only)", labelAr: "منتهي - عرض فقط" },
};
