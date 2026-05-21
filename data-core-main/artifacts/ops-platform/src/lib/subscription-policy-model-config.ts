/**
 * @file   subscription-policy-model-config.ts
 * @phase  P16-D - Grace Period & Suspension Rules
 */

export const SUBSCRIPTION_POLICY_MODEL_SAFETY_CONTRACT = {
  subscriptionPolicyModelOnly: true,
  advisoryOnlyDefault: true,
  noAutomaticEnforcement: true,
  noTenantLoginBlocking: true,
  noModuleAccessBlocking: true,
  noWorkspaceShutdown: true,
  noDestructiveWorkspaceActions: true,
  noHardQuotaEnforcement: true,
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
  auditPolicyChanges: true,
} as const satisfies Record<string, true>;

void (() => {
  for (const [key, value] of Object.entries(SUBSCRIPTION_POLICY_MODEL_SAFETY_CONTRACT)) {
    if (value !== true) {
      throw new Error(`SUBSCRIPTION_POLICY_MODEL_SAFETY_CONTRACT violated: ${key} must be true`);
    }
  }
})();

export const ENFORCEMENT_MODE_LABELS: Record<string, { label: string; labelAr: string }> = {
  advisory_only: { label: "Advisory only", labelAr: "إرشادي فقط" },
  manual_required: { label: "Manual required", labelAr: "يتطلب تدخل يدوي" },
  automatic_recommended: { label: "Automatic recommended", labelAr: "آلي موصى به" },
};

export const RECOMMENDED_STATUS_LABELS: Record<string, { label: string; labelAr: string; className: string }> = {
  active: {
    label: "Active",
    labelAr: "نشط",
    className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  },
  grace_period: {
    label: "Grace period",
    labelAr: "فترة سماح",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
  past_due: {
    label: "Past due",
    labelAr: "متأخر",
    className: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  },
  suspended: {
    label: "Suspended",
    labelAr: "معلق",
    className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  },
  terminated: {
    label: "Terminated",
    labelAr: "منتهي",
    className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  },
  no_change: {
    label: "No change",
    labelAr: "بدون تغيير",
    className: "bg-muted text-muted-foreground",
  },
  review_required: {
    label: "Review required",
    labelAr: "يتطلب مراجعة",
    className: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  },
};

export const RECOMMENDED_ACTION_LABELS: Record<string, string> = {
  none: "None",
  mark_grace_period: "Mark grace period",
  mark_past_due: "Mark past due",
  mark_suspended: "Mark suspended",
  mark_terminated: "Mark terminated",
  review_required: "Review required",
};
