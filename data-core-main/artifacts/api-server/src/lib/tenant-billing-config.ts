/**
 * @phase P15-D - Tenant Billing Portal (read-only invoice visibility)
 */

export const TENANT_BILLING_PERMISSIONS = {
  INVOICES_READ: "tenant.billing.invoices.read",
  INVOICE_DOCUMENTS_DOWNLOAD: "tenant.billing.invoiceDocuments.download",
} as const;

/** Statuses visible to workspace members (draft is platform-internal). */
export const TENANT_VISIBLE_INVOICE_STATUSES = [
  "issued",
  "shared",
  "paid",
  "overdue",
  "cancelled",
] as const;

export const TENANT_BILLING_SAFETY_CONTRACT = {
  tenantReadOnlyBilling: true,
  noTenantInvoiceUpload: true,
  noTenantInvoiceEdit: true,
  noTenantInvoiceDelete: true,
  noElectronicPayment: true,
  noStripe: true,
  noCheckout: true,
  noCardStorage: true,
  noPaymentGateway: true,
  noInvoiceGenerationEngine: true,
  noTaxCalculation: true,
  noZatcaIntegration: true,
  noEmailSending: true,
  protectedPdfDownload: true,
  noPublicInvoiceUrls: true,
  enforceWorkspaceIsolation: true,
  auditTenantInvoiceAccess: true,
} as const satisfies Record<string, true>;
