/**
 * @file   quota-model-config.ts
 * @phase  P16-C - Workspace Limits & Quotas
 */

export const QUOTA_MODEL_SAFETY_CONTRACT = {
  quotaModelOnly: true,
  usageIndicatorsOnly: true,
  noHardEnforcement: true,
  noTenantLoginBlocking: true,
  noAutomaticSuspension: true,
  noDestructiveCleanup: true,
  noElectronicPayment: true,
  noStripe: true,
  noCheckout: true,
  noPaymentGateway: true,
  noInvoiceGenerationEngine: true,
  noTaxCalculation: true,
  noZatcaIntegration: true,
  noAccountingLedger: true,
  noEmailSending: true,
  noCustomPermissions: true,
  permissionGated: true,
  auditQuotaChanges: true,
} as const satisfies Record<string, true>;

void (() => {
  for (const [key, value] of Object.entries(QUOTA_MODEL_SAFETY_CONTRACT)) {
    if (value !== true) {
      throw new Error(`QUOTA_MODEL_SAFETY_CONTRACT violated: ${key} must be true`);
    }
  }
})();

export const QUOTA_SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  subscription_plan: "Subscription plan",
  contract_override: "Contract override",
  trial: "Trial",
  system_default: "System default",
};

export type QuotaUsageStatus = "ok" | "warning" | "exceeded" | "unlimited" | "unknown";

export const QUOTA_STATUS_BADGE: Record<
  QuotaUsageStatus,
  { label: string; labelAr: string; className: string }
> = {
  ok: {
    label: "OK",
    labelAr: "طبيعي",
    className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  },
  warning: {
    label: "Warning",
    labelAr: "تحذير",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
  exceeded: {
    label: "Exceeded",
    labelAr: "تجاوز",
    className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  },
  unlimited: {
    label: "Unlimited",
    labelAr: "غير محدود",
    className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  },
  unknown: {
    label: "Unknown",
    labelAr: "غير معروف",
    className: "bg-muted text-muted-foreground",
  },
};
