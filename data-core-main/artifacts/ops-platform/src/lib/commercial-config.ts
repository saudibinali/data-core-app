/**
 * commercial-config.ts
 *
 * @phase P15-A - Commercial Accounts & Billing Contacts
 *
 * Pure module - no React, no network, no DB.
 * Defines status configs, contact role configs, permission config,
 * and the Commercial Safety Contract enforced at import time.
 */

// ── Safety Contract ───────────────────────────────────────────────────────────

export const COMMERCIAL_SAFETY_CONTRACT = {
  enterpriseOnly:          true,
  noElectronicPayment:     true,
  noStripe:                true,
  noCheckout:              true,
  noCardStorage:           true,
  noAutoCharge:            true,
  noPaymentGateway:        true,
  noInvoiceGenerationEngine: true,
  noInvoicePdfGeneration:  true,
  uploadedInvoicePdfOnly:  true,
  noTaxCalculation:        true,
  noZatcaIntegration:      true,
  noAccountingLedger:      true,
  noTenantSideVisibility:  true,
  noTenantSideBillingPortal: true,
  noTenantSideBillingPortalFull: true,
  noCustomerPaymentPortal: true,
  noEmailSending:          true,
  noPoTracking:            true,
  noCustomPermissions:     true,
  manualPaymentsOnly:      true,
  noTenantPaymentActions:  true,
  noHardDeletePayment:     true,
  noSensitiveBankFields:   true,
  noBankApiIntegration:    true,
  paymentPermissionGated:  true,
  auditPaymentActions:     true,
  noDeleteContact:         true,
  noDeleteContract:        true,
  noHardDeleteInvoice:     true,
  noDeleteDocument:        true,
  protectedPdfDownload:    true,
  pdfOnlyUpload:           true,
  permissionGated:         true,
  auditCommercialChanges:  true,
  auditCommercialContractChanges: true,
  auditInvoiceChanges:       true,
  auditInvoiceDocumentAccess: true,
  commercialRiskReadOnly:    true,
  noAutomatedDunning:        true,
  noAutomatedRenewalActions: true,
  noTenantCustomerActions:   true,
  noAutoStatusChanges:       true,
  riskPermissionGated:       true,
  auditRiskDetailViews:      true,
  commercialConsoleReadOnlyIntegration: true,
  noDestructiveCommercialActions: true,
  sectionPermissionGated: true,
  riskReadOnlyIntegrated: true,
} as const satisfies Record<string, true>;

// Import-time guard
void (() => {
  for (const [key, value] of Object.entries(COMMERCIAL_SAFETY_CONTRACT)) {
    if (value !== true) {
      throw new Error(`COMMERCIAL_SAFETY_CONTRACT violated: ${key} must be true`);
    }
  }
})();

// ── Commercial Account Status ─────────────────────────────────────────────────

export type CommercialAccountStatus = "draft" | "active" | "under_review" | "inactive";

export interface CommercialAccountStatusConfig {
  readonly code: CommercialAccountStatus;
  readonly label: string;
  readonly labelAr: string;
  readonly variant: "default" | "secondary" | "destructive" | "outline";
  readonly description: string;
}

export const COMMERCIAL_ACCOUNT_STATUS_CONFIG: Record<CommercialAccountStatus, CommercialAccountStatusConfig> = {
  draft: {
    code:        "draft",
    label:       "Draft",
    labelAr:     "مسودة",
    variant:     "secondary",
    description: "Commercial account is in draft - not yet active.",
  },
  active: {
    code:        "active",
    label:       "Active",
    labelAr:     "نشط",
    variant:     "default",
    description: "Commercial account is active and in good standing.",
  },
  under_review: {
    code:        "under_review",
    label:       "Under Review",
    labelAr:     "تحت المراجعة",
    variant:     "outline",
    description: "Commercial account is under internal review.",
  },
  inactive: {
    code:        "inactive",
    label:       "Inactive",
    labelAr:     "غير نشط",
    variant:     "destructive",
    description: "Commercial account is inactive.",
  },
};

export const COMMERCIAL_ACCOUNT_STATUS_CODES = Object.keys(
  COMMERCIAL_ACCOUNT_STATUS_CONFIG,
) as CommercialAccountStatus[];

// ── Billing Contact Role ──────────────────────────────────────────────────────

export type BillingContactRole =
  | "finance_contact"
  | "procurement_contact"
  | "contract_owner"
  | "executive_sponsor"
  | "other";

export interface BillingContactRoleConfig {
  readonly code: BillingContactRole;
  readonly label: string;
  readonly labelAr: string;
  readonly description: string;
}

export const BILLING_CONTACT_ROLE_CONFIG: Record<BillingContactRole, BillingContactRoleConfig> = {
  finance_contact: {
    code:        "finance_contact",
    label:       "Finance Contact",
    labelAr:     "جهة التواصل المالية",
    description: "Primary finance or accounts-payable contact at the client.",
  },
  procurement_contact: {
    code:        "procurement_contact",
    label:       "Procurement Contact",
    labelAr:     "جهة المشتريات",
    description: "Procurement or vendor management contact at the client.",
  },
  contract_owner: {
    code:        "contract_owner",
    label:       "Contract Owner",
    labelAr:     "مالك العقد",
    description: "The person who owns or signs the commercial agreement.",
  },
  executive_sponsor: {
    code:        "executive_sponsor",
    label:       "Executive Sponsor",
    labelAr:     "الراعي التنفيذي",
    description: "Executive-level sponsor or champion of the engagement.",
  },
  other: {
    code:        "other",
    label:       "Other",
    labelAr:     "أخرى",
    description: "Other billing or commercial contact role.",
  },
};

export const BILLING_CONTACT_ROLE_CODES = Object.keys(
  BILLING_CONTACT_ROLE_CONFIG,
) as BillingContactRole[];

// ── Commercial Permission Config ──────────────────────────────────────────────

export interface CommercialPermissionEntry {
  readonly code: string;
  readonly label: string;
  readonly labelAr: string;
  readonly description: string;
}

export const COMMERCIAL_PERMISSION_CONFIG: Record<string, CommercialPermissionEntry> = {
  "commercial.accounts.read": {
    code:        "commercial.accounts.read",
    label:       "Read Commercial Accounts",
    labelAr:     "قراءة الحسابات التجارية",
    description: "View commercial account details for tenant workspaces.",
  },
  "commercial.accounts.update": {
    code:        "commercial.accounts.update",
    label:       "Update Commercial Accounts",
    labelAr:     "تحديث الحسابات التجارية",
    description: "Create or update commercial account information for tenant workspaces.",
  },
  "commercial.contacts.read": {
    code:        "commercial.contacts.read",
    label:       "Read Billing Contacts",
    labelAr:     "قراءة جهات تواصل الفوترة",
    description: "View billing contact information for commercial accounts. Contains sensitive contact data.",
  },
  "commercial.contacts.update": {
    code:        "commercial.contacts.update",
    label:       "Update Billing Contacts",
    labelAr:     "تحديث جهات تواصل الفوترة",
    description: "Create or update billing contacts for commercial accounts.",
  },
  "commercial.contracts.read": {
    code:        "commercial.contracts.read",
    label:       "Read Commercial Contracts",
    labelAr:     "قراءة عقود التجديد التجارية",
    description: "View contract terms and renewal commitments for tenant workspaces.",
  },
  "commercial.contracts.update": {
    code:        "commercial.contracts.update",
    label:       "Update Commercial Contracts",
    labelAr:     "تحديث عقود التجديد التجارية",
    description: "Create or update contract terms and renewal commitments.",
  },
  "commercial.invoices.read": {
    code:        "commercial.invoices.read",
    label:       "Read Commercial Invoices",
    labelAr:     "قراءة فواتير المستأجر",
    description: "View enterprise invoice records for tenant workspaces.",
  },
  "commercial.invoices.update": {
    code:        "commercial.invoices.update",
    label:       "Update Commercial Invoices",
    labelAr:     "تحديث فواتير المستأجر",
    description: "Create or update invoice records (metadata only).",
  },
  "commercial.invoiceDocuments.read": {
    code:        "commercial.invoiceDocuments.read",
    label:       "Read Invoice PDF Documents",
    labelAr:     "قراءة مستندات الفواتير",
    description: "Download uploaded official invoice PDFs.",
  },
  "commercial.invoiceDocuments.upload": {
    code:        "commercial.invoiceDocuments.upload",
    label:       "Upload Invoice PDF Documents",
    labelAr:     "رفع مستندات الفواتير",
    description: "Upload official invoice PDFs from external accounting systems.",
  },
  "commercial.payments.read": {
    code:        "commercial.payments.read",
    label:       "Read Manual Payment Records",
    labelAr:     "قراءة سجلات الدفع اليدوي",
    description: "View manual payment records and collection summaries.",
  },
  "commercial.payments.record": {
    code:        "commercial.payments.record",
    label:       "Record Manual Payments",
    labelAr:     "تسجيل دفعات يدوية",
    description: "Record off-platform payments against invoices.",
  },
  "commercial.payments.verify": {
    code:        "commercial.payments.verify",
    label:       "Verify Manual Payments",
    labelAr:     "التحقق من الدفعات اليدوية",
    description: "Verify, reject, or reverse manual payment records.",
  },
  "commercial.risk.read": {
    code:        "commercial.risk.read",
    label:       "Read Commercial Risk",
    labelAr:     "قراءة المخاطر التجارية",
    description: "View commercial risk and renewal readiness intelligence.",
  },
};

// ── Commercial risk (P15-F) ───────────────────────────────────────────────────

export type CommercialRiskLevel = "low" | "medium" | "high" | "critical";

export type RenewalReadinessStatus =
  | "ready"
  | "attention_needed"
  | "at_risk"
  | "blocked"
  | "no_active_contract";

export const COMMERCIAL_RISK_LEVEL_CONFIG: Record<
  CommercialRiskLevel,
  { label: string; labelAr: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  low:      { label: "Low",      labelAr: "منخفض",   variant: "default" },
  medium:   { label: "Medium",   labelAr: "متوسط",   variant: "outline" },
  high:     { label: "High",     labelAr: "مرتفع",   variant: "secondary" },
  critical: { label: "Critical", labelAr: "حرج",     variant: "destructive" },
};

export const RENEWAL_READINESS_CONFIG: Record<
  RenewalReadinessStatus,
  { label: string; labelAr: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  ready:               { label: "Ready",               labelAr: "جاهز",              variant: "default" },
  attention_needed:    { label: "Attention Needed",    labelAr: "يحتاج انتباه",      variant: "outline" },
  at_risk:             { label: "At Risk",             labelAr: "معرّض للخطر",       variant: "secondary" },
  blocked:             { label: "Blocked",             labelAr: "محظور",             variant: "destructive" },
  no_active_contract:  { label: "No Active Contract",  labelAr: "لا يوجد عقد نشط",   variant: "destructive" },
};

export const RISK_REASON_LABELS: Record<string, { en: string; ar: string }> = {
  active_contract_missing:          { en: "No active contract", ar: "لا يوجد عقد نشط" },
  contract_expired:                 { en: "Contract expired", ar: "انتهى العقد" },
  renewal_notice_window_open:       { en: "Renewal notice window open", ar: "نافذة إشعار التجديد مفتوحة" },
  renewal_commitment_not_committed: { en: "Renewal not committed", ar: "التزام التجديد غير مؤكد" },
  overdue_invoices_present:         { en: "Overdue invoices", ar: "فواتير متأخرة" },
  outstanding_amount_present:       { en: "Outstanding balance", ar: "رصيد مستحق" },
  rejected_payment_present:         { en: "Rejected payment(s)", ar: "دفعة مرفوضة" },
  billing_contact_missing:          { en: "Billing contact missing", ar: "جهة فوترة مفقودة" },
  invoice_pdf_missing:              { en: "Invoice PDF missing", ar: "ملف PDF فاتورة مفقود" },
};

export const RECOMMENDED_ACTION_LABELS: Record<string, { en: string; ar: string }> = {
  review_contract_terms:     { en: "Review contract terms", ar: "مراجعة شروط العقد" },
  contact_customer_owner:  { en: "Contact customer owner", ar: "التواصل مع مالك العميل" },
  verify_collection_status:  { en: "Verify collection status", ar: "التحقق من حالة التحصيل" },
  upload_missing_invoice_pdf:  { en: "Upload missing invoice PDF", ar: "رفع PDF الفاتورة المفقود" },
  update_renewal_commitment:   { en: "Update renewal commitment", ar: "تحديث التزام التجديد" },
  review_billing_contacts:     { en: "Review billing contacts", ar: "مراجعة جهات الفوترة" },
};

// ── Contract term status (P15-B) ─────────────────────────────────────────────

export type CommercialContractStatus = "draft" | "active" | "expired" | "terminated" | "archived";

export type RenewalType = "manual" | "auto_renewal" | "non_renewing" | "under_negotiation";

export type RenewalCommitmentStatus =
  | "not_started"
  | "pending_customer"
  | "pending_internal"
  | "committed"
  | "declined"
  | "expired";

export type BillingCycle = "monthly" | "quarterly" | "semi_annual" | "annual" | "custom";

export type PaymentTerms = "due_on_receipt" | "net_15" | "net_30" | "net_45" | "net_60" | "custom";

export const COMMERCIAL_CONTRACT_STATUS_CONFIG: Record<
  CommercialContractStatus,
  { label: string; labelAr: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  draft:      { label: "Draft",      labelAr: "مسودة",      variant: "secondary" },
  active:     { label: "Active",     labelAr: "نشط",        variant: "default" },
  expired:    { label: "Expired",    labelAr: "منتهٍ",      variant: "outline" },
  terminated: { label: "Terminated", labelAr: "منهٍ",       variant: "destructive" },
  archived:   { label: "Archived",   labelAr: "مؤرشف",      variant: "secondary" },
};

export const RENEWAL_TYPE_CONFIG: Record<RenewalType, { label: string; labelAr: string }> = {
  manual:             { label: "Manual",             labelAr: "يدوي" },
  auto_renewal:       { label: "Auto Renewal",       labelAr: "تجديد تلقائي" },
  non_renewing:       { label: "Non-Renewing",       labelAr: "بدون تجديد" },
  under_negotiation:  { label: "Under Negotiation",  labelAr: "قيد التفاوض" },
};

export const RENEWAL_COMMITMENT_STATUS_CONFIG: Record<
  RenewalCommitmentStatus,
  { label: string; labelAr: string }
> = {
  not_started:        { label: "Not Started",        labelAr: "لم يبدأ" },
  pending_customer:   { label: "Pending Customer",   labelAr: "بانتظار العميل" },
  pending_internal:   { label: "Pending Internal",   labelAr: "بانتظار داخلي" },
  committed:          { label: "Committed",          labelAr: "ملتزم" },
  declined:           { label: "Declined",           labelAr: "مرفوض" },
  expired:            { label: "Expired",            labelAr: "منتهٍ" },
};

export const BILLING_CYCLE_CONFIG: Record<BillingCycle, { label: string; labelAr: string }> = {
  monthly:      { label: "Monthly",      labelAr: "شهري" },
  quarterly:    { label: "Quarterly",    labelAr: "ربع سنوي" },
  semi_annual:  { label: "Semi-Annual",  labelAr: "نصف سنوي" },
  annual:       { label: "Annual",       labelAr: "سنوي" },
  custom:       { label: "Custom",       labelAr: "مخصص" },
};

export const PAYMENT_TERMS_CONFIG: Record<PaymentTerms, { label: string; labelAr: string }> = {
  due_on_receipt: { label: "Due on Receipt", labelAr: "عند الاستلام" },
  net_15:         { label: "Net 15",         labelAr: "صافي 15" },
  net_30:         { label: "Net 30",         labelAr: "صافي 30" },
  net_45:         { label: "Net 45",         labelAr: "صافي 45" },
  net_60:         { label: "Net 60",         labelAr: "صافي 60" },
  custom:         { label: "Custom",         labelAr: "مخصص" },
};

export const SUPPORTED_CONTRACT_CURRENCIES = ["SAR", "USD", "EUR", "GBP", "AED", "KWD", "BHD", "OMR", "QAR"] as const;

// ── Invoice status (P15-C) ─────────────────────────────────────────────────────

export type CommercialInvoiceStatus =
  | "draft"
  | "issued"
  | "shared"
  | "paid"
  | "overdue"
  | "cancelled";

export const COMMERCIAL_INVOICE_STATUS_CONFIG: Record<
  CommercialInvoiceStatus,
  { label: string; labelAr: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  draft:     { label: "Draft",     labelAr: "مسودة",      variant: "secondary" },
  issued:    { label: "Issued",    labelAr: "صادرة",      variant: "default" },
  shared:    { label: "Shared",    labelAr: "مشاركة",     variant: "outline" },
  paid:      { label: "Paid",      labelAr: "مدفوعة",     variant: "default" },
  overdue:   { label: "Overdue",   labelAr: "متأخرة",     variant: "destructive" },
  cancelled: { label: "Cancelled", labelAr: "ملغاة",      variant: "destructive" },
};

export const COMMERCIAL_INVOICE_STATUS_CODES = Object.keys(
  COMMERCIAL_INVOICE_STATUS_CONFIG,
) as CommercialInvoiceStatus[];

export const INVOICE_PDF_MAX_BYTES = 10 * 1024 * 1024;

// ── Manual payments (P15-E) ───────────────────────────────────────────────────

export type PaymentMethod =
  | "bank_transfer"
  | "cheque"
  | "cash"
  | "internal_adjustment"
  | "other";

export type CollectionStatus =
  | "pending_verification"
  | "verified"
  | "rejected"
  | "partially_applied"
  | "reversed";

export type CollectionState =
  | "unpaid"
  | "partially_paid"
  | "paid"
  | "overpaid"
  | "disputed";

export const PAYMENT_METHOD_CONFIG: Record<PaymentMethod, { label: string; labelAr: string }> = {
  bank_transfer:        { label: "Bank Transfer",        labelAr: "تحويل بنكي" },
  cheque:               { label: "Cheque",               labelAr: "شيك" },
  cash:                 { label: "Cash",                 labelAr: "نقدي" },
  internal_adjustment:  { label: "Internal Adjustment", labelAr: "تسوية داخلية" },
  other:                { label: "Other",                labelAr: "أخرى" },
};

export const COLLECTION_STATUS_CONFIG: Record<
  CollectionStatus,
  { label: string; labelAr: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  pending_verification: { label: "Pending Verification", labelAr: "بانتظار التحقق", variant: "outline" },
  verified:             { label: "Verified",             labelAr: "مُحقق",          variant: "default" },
  rejected:             { label: "Rejected",             labelAr: "مرفوض",          variant: "destructive" },
  partially_applied:    { label: "Partially Applied",    labelAr: "مطبّق جزئياً",   variant: "secondary" },
  reversed:             { label: "Reversed",             labelAr: "معكوس",          variant: "destructive" },
};

export const COLLECTION_STATE_CONFIG: Record<
  CollectionState,
  { label: string; labelAr: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  unpaid:          { label: "Unpaid",          labelAr: "غير مدفوعة",     variant: "destructive" },
  partially_paid:  { label: "Partially Paid",  labelAr: "مدفوعة جزئياً",  variant: "outline" },
  paid:            { label: "Paid",            labelAr: "مدفوعة",         variant: "default" },
  overpaid:        { label: "Overpaid",        labelAr: "زيادة دفع",      variant: "secondary" },
  disputed:        { label: "Disputed",        labelAr: "متنازع عليها",   variant: "destructive" },
};

export const PAYMENT_METHOD_CODES = Object.keys(PAYMENT_METHOD_CONFIG) as PaymentMethod[];
export const COLLECTION_STATUS_CODES = Object.keys(COLLECTION_STATUS_CONFIG) as CollectionStatus[];

// ── Field Labels (EN + AR) ────────────────────────────────────────────────────

export const COMMERCIAL_FIELD_LABELS = {
  commercial_account:               { en: "Commercial Account",            ar: "الحساب التجاري" },
  billing_contacts:                 { en: "Billing Contacts",              ar: "جهات تواصل الفوترة" },
  account_manager:                  { en: "Account Manager",               ar: "مدير الحساب" },
  finance_contact:                  { en: "Finance Contact",               ar: "جهة التواصل المالية" },
  contract_owner:                   { en: "Contract Owner",                ar: "مالك العقد" },
  billing_email:                    { en: "Billing Email",                 ar: "بريد الفوترة" },
  billing_phone:                    { en: "Billing Phone",                 ar: "رقم تواصل الفوترة" },
  company_tax_number_placeholder:   { en: "Tax Number (Placeholder)",      ar: "رقم ضريبي مبدئي" },
  commercial_notes:                 { en: "Commercial Notes",              ar: "ملاحظات تجارية" },
  legal_entity_name:                { en: "Legal Entity Name",             ar: "الاسم القانوني للجهة" },
  commercial_account_name:          { en: "Commercial Account Name",       ar: "اسم الحساب التجاري" },
  contract_owner_email:             { en: "Contract Owner Email",          ar: "بريد مالك العقد" },
} as const;

// ── Validation Constants ──────────────────────────────────────────────────────

export const COMMERCIAL_VALIDATION = {
  commercialAccountName: { maxLength: 200 },
  legalEntityName:       { maxLength: 200 },
  commercialNotes:       { maxLength: 2000 },
  contactName:           { maxLength: 150 },
  contactPhone:          { maxLength: 30 },
  billingPhone:          { maxLength: 30 },
  companyTaxNumber:      { maxLength: 100 },
} as const;
