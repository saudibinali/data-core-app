/**
 * @phase P16-F - Subscription Console integration (UI only)
 */

export const SUBSCRIPTION_CONSOLE_SAFETY_CONTRACT = {
  subscriptionConsoleIntegrationOnly: true,
  noNewEnforcement: true,
  noAutomaticSuspension: true,
  noTenantLoginBlocking: true,
  noNewModuleBlocking: true,
  noDestructiveWorkspaceActions: true,
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
  sectionPermissionGated: true,
  navigationOverflowHandled: true,
  contractVersion: "1.0.0-P16-F",
} as const;

export const SUBSCRIPTION_CONSOLE_FORBIDDEN_UI_TERMS = [
  "Pay Now",
  "Stripe",
  "Checkout",
  "Auto Suspend",
  "Block Login",
  "Delete Workspace",
  "Purge Data",
  "Send Email",
  "Auto Charge",
  "Generate Invoice",
  "ZATCA",
] as const;
