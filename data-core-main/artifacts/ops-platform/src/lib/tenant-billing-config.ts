/**
 * @phase P15-D - Tenant Billing Portal (read-only invoice visibility)
 */

export const TENANT_BILLING_PERMISSIONS = {
  INVOICES_READ: "tenant.billing.invoices.read",
  INVOICE_DOCUMENTS_DOWNLOAD: "tenant.billing.invoiceDocuments.download",
} as const;

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

void (() => {
  for (const [key, value] of Object.entries(TENANT_BILLING_SAFETY_CONTRACT)) {
    if (value !== true) {
      throw new Error(`TENANT_BILLING_SAFETY_CONTRACT violated: ${key} must be true`);
    }
  }
})();

export type TenantBillingInvoiceStatus =
  | "issued"
  | "shared"
  | "paid"
  | "overdue"
  | "cancelled";

export interface TenantBillingInvoice {
  id: number;
  invoiceNumber: string;
  invoiceTitle: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  invoiceAmount: string | null;
  currency: string | null;
  billingPeriodStart: string | null;
  billingPeriodEnd: string | null;
  status: string;
  documentAvailable: boolean;
  documentFileName: string | null;
  uploadedAt: string | null;
}
