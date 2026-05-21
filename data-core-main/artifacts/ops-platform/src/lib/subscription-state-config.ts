/**
 * @file   subscription-state-config.ts
 * @phase  P16-A - Subscription State Model
 */

export const SUBSCRIPTION_STATE_SAFETY_CONTRACT = {
  subscriptionStateOnly: true,
  noSubscriptionEnforcement: true,
  noModuleAccessBlocking: true,
  noTenantLoginBlocking: true,
  noElectronicPayment: true,
  noStripe: true,
  noCheckout: true,
  noCardStorage: true,
  noPaymentGateway: true,
  noInvoiceGenerationEngine: true,
  noTaxCalculation: true,
  noZatcaIntegration: true,
  noAccountingLedger: true,
  noEmailSending: true,
  noDestructiveWorkspaceActions: true,
  noCustomPermissions: true,
  permissionGated: true,
  auditSubscriptionChanges: true,
} as const satisfies Record<string, true>;

void (() => {
  for (const [key, value] of Object.entries(SUBSCRIPTION_STATE_SAFETY_CONTRACT)) {
    if (value !== true) {
      throw new Error(`SUBSCRIPTION_STATE_SAFETY_CONTRACT violated: ${key} must be true`);
    }
  }
})();

export const WORKSPACE_SUBSCRIPTION_STATUS_CODES = [
  "trial",
  "active",
  "grace_period",
  "past_due",
  "suspended",
  "terminated",
  "archived",
] as const;

export type WorkspaceSubscriptionStatusCode =
  (typeof WORKSPACE_SUBSCRIPTION_STATUS_CODES)[number];

export interface WorkspaceSubscriptionStatusConfig {
  readonly code: WorkspaceSubscriptionStatusCode;
  readonly label: string;
  readonly labelAr: string;
  readonly badgeClass: string;
}

export const WORKSPACE_SUBSCRIPTION_STATUS_CONFIG: Record<
  WorkspaceSubscriptionStatusCode,
  WorkspaceSubscriptionStatusConfig
> = {
  trial: {
    code: "trial",
    label: "Trial",
    labelAr: "تجريبي",
    badgeClass: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  },
  active: {
    code: "active",
    label: "Active",
    labelAr: "نشط",
    badgeClass: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  },
  grace_period: {
    code: "grace_period",
    label: "Grace Period",
    labelAr: "فترة سماح",
    badgeClass: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  },
  past_due: {
    code: "past_due",
    label: "Past Due",
    labelAr: "متأخر",
    badgeClass: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  },
  suspended: {
    code: "suspended",
    label: "Suspended",
    labelAr: "موقوف",
    badgeClass: "bg-red-500/15 text-red-700 dark:text-red-300",
  },
  terminated: {
    code: "terminated",
    label: "Terminated",
    labelAr: "منتهي",
    badgeClass: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
  },
  archived: {
    code: "archived",
    label: "Archived",
    labelAr: "مؤرشف",
    badgeClass: "bg-muted text-muted-foreground",
  },
};
