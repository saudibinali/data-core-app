/**
 * @file   pages/super-admin-tenants.tsx
 * @phase  P13-A/B/C - Platform Tenant Registry, Lifecycle & Subscription Management
 *         P13-D - Entitlement & Module Access
 *         P13-E - Usage & Capacity Intelligence
 *         P13-F - Subscription Expiry, Grace Period & Renewal Intelligence
 *         P13-G - Tenant Health, Risk Signals & Operational Monitoring
 *         P13-H - Tenant Administration Console Consolidation
 *
 * SAFETY CONTRACT (Registry - P13-A):
 *   - Registry data is read-only. Super-admin access enforced by SuperAdminRoute.
 *   - Subscription / plan fields displayed as "not configured" when null.
 *
 * LIFECYCLE CONTROLS (P13-B):
 *   - Controlled state transitions. Requires reason + confirmation. Audit-logged.
 *   - No workspace deletion, billing changes, HR data, or email notifications.
 *
 * SUBSCRIPTION MANAGEMENT (P13-C):
 *   - Subscription metadata only - no payment, invoice, charge, tax, or card data.
 *   - Requires reason + confirmation. Audit-logged. Super-admin only.
 *   - No automatic workspace suspension or entitlement enforcement.
 *   - Governed by SUBSCRIPTION_SAFETY_CONTRACT from subscription-lifecycle-config.ts.
 *
 * CONSOLE CONSOLIDATION (P13-H):
 *   - Governed by TENANT_ADMIN_CONSOLE_SAFETY_CONTRACT.
 *   - Overview is read-only. All mutations stay in dedicated sections.
 *   - No payment, billing, invoice, charge, tax, auto-suspend, enforcement, or email UI.
 */

import React, { useState, useMemo, useEffect } from "react";
import {
  Building2,
  Users,
  AlertTriangle,
  Search,
  ChevronDown,
  ChevronRight,
  Info,
  ShieldCheck,
  Activity,
  Package,
  Loader2,
  CreditCard,
  RefreshCw,
  CheckCircle2,
  BarChart3,
  Heart,
  LayoutDashboard,
  ClipboardList,
  Briefcase,
  Shield,
  Mail,
  Phone,
  UserCheck,
  Star,
  PlusCircle,
  Pencil,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  TENANT_STATUS_MAP,
  SUBSCRIPTION_STATUS_MAP,
  RISK_LEVEL_MAP,
  TENANT_STATUS_FILTER_OPTIONS,
  SUBSCRIPTION_STATUS_FILTER_OPTIONS,
  RISK_LEVEL_FILTER_OPTIONS,
  TENANT_REGISTRY_EMPTY_STATE,
  TENANT_REGISTRY_SAFETY_CONTRACT,
} from "@/lib/tenant-registry-config";
import {
  LIFECYCLE_ACTION_CONFIG,
  LIFECYCLE_SEVERITY_STYLE,
  LIFECYCLE_EMPTY_STATE,
  deriveLifecycleStateFromWorkspaceStatus,
  getAllowedActionsFromState,
  isLifecycleFormValid,
  getLifecycleFormError,
  REASON_MIN_LENGTH,
  type WorkspaceLifecycleAction,
  type LifecycleFormState,
} from "@/lib/workspace-lifecycle-config";
import {
  useTenantRegistry,
  useWorkspaceLifecycleTransition,
  useUpdateTenantSubscription,
  useTenantEntitlements,
  useUpdateTenantEntitlementOverrides,
  useTenantUsage,
  useTenantRenewalIntelligence,
  type PlatformTenantProfile,
} from "@/lib/tenant-registry-hooks";

import {
  MODULE_REGISTRY_CONFIG,
  FEATURE_LIMIT_CONFIG,
  ALL_MODULE_CODES,
  ALL_LIMIT_CODES,
  ALL_OVERRIDE_TYPES,
  OVERRIDE_TYPE_CONFIG,
  ENTITLEMENT_SAFETY_CONTRACT,
  ENTITLEMENT_EMPTY_STATE,
  getEntitlementOverrideFormError,
  isEntitlementOverrideFormValid,
  type EntitlementOverrideFormState,
} from "@/lib/platform-entitlements-config";

import {
  useCommercialAccount,
  useUpsertCommercialAccount,
  useBillingContacts,
  useCreateBillingContact,
  useUpdateBillingContact,
  useSetPrimaryBillingContact,
  type CommercialAccount,
  type BillingContact,
  type CommercialAccountUpsertInput,
  type BillingContactCreateInput,
  type BillingContactUpdateInput,
} from "@/hooks/use-commercial";
import {
  COMMERCIAL_SAFETY_CONTRACT,
  COMMERCIAL_ACCOUNT_STATUS_CONFIG,
  BILLING_CONTACT_ROLE_CONFIG,
  BILLING_CONTACT_ROLE_CODES,
  type CommercialAccountStatus,
  type BillingContactRole,
} from "@/lib/commercial-config";
import { CommercialConsole } from "@/components/commercial/CommercialConsole";
import { TenantCommercialConsole } from "@/components/subscription/TenantCommercialConsole";
import {
  PLAN_CODE_CONFIG,
  SUBSCRIPTION_STATUS_CONFIG,
  ALL_PLAN_CODES,
  ALL_SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_EMPTY_STATE,
  SUBSCRIPTION_SAFETY_CONTRACT,
  REASON_MIN_LENGTH as SUB_REASON_MIN_LENGTH,
  isSubscriptionFormValid,
  getSubscriptionFormError,
  type SubscriptionFormState,
} from "@/lib/subscription-lifecycle-config";
import {
  USAGE_METRIC_CONFIG,
  USAGE_STATUS_CONFIG,
  CAPACITY_RISK_CONFIG,
  METRIC_SOURCE_CONFIG,
  USAGE_SAFETY_CONTRACT,
  USAGE_EMPTY_STATE,
  ALL_USAGE_METRIC_CODES,
  type UsageMetricCode,
  type CapacityRiskLevel,
} from "@/lib/platform-usage-config";
import {
  RENEWAL_SIGNAL_CONFIG,
  RENEWAL_URGENCY_CONFIG,
  RECOMMENDED_PLATFORM_ACTION_CONFIG,
  RENEWAL_INTELLIGENCE_SAFETY_CONTRACT,
  RENEWAL_EMPTY_STATE,
  type RenewalSignalCode,
  type RenewalUrgency,
  type RecommendedPlatformAction,
} from "@/lib/renewal-intelligence-config";
import {
  TENANT_HEALTH_STATUS_CONFIG,
  TENANT_HEALTH_RISK_CONFIG,
  TENANT_HEALTH_SIGNAL_CONFIG,
  TENANT_HEALTH_ACTION_CONFIG,
  TENANT_HEALTH_SAFETY_CONTRACT,
  TENANT_HEALTH_EMPTY_STATE,
  type TenantHealthSignalCode,
  type TenantHealthStatus,
  type TenantHealthRiskLevel,
  type RecommendedTenantHealthAction,
} from "@/lib/tenant-health-config";
import {
  useTenantHealth,
  useTenantLifecycleEvaluation,
  type TenantLifecycleEvaluationProfileData,
} from "@/lib/tenant-registry-hooks";
import {
  LIFECYCLE_EVALUATION_SIGNAL_CONFIG,
  LIFECYCLE_EVALUATION_SEVERITY_CONFIG,
  LIFECYCLE_EVALUATION_ACTION_CONFIG,
  REVIEW_ELIGIBILITY_CONFIG,
  LIFECYCLE_EVALUATION_SAFETY_CONTRACT,
  LIFECYCLE_EVALUATION_EMPTY_STATE,
  EVALUATION_FORBIDDEN_WORDING,
  type EvaluationSignalCode,
  type EvaluationSeverity,
  type EvaluationRecommendedAction,
} from "@/lib/lifecycle-evaluation-config";
import {
  TENANT_ADMIN_CONSOLE_SAFETY_CONTRACT,
  CONSOLE_TAB_CONFIG,
  CONSOLE_TABS,
  CONSOLE_TAB_CONTENT_TEST_IDS,
  dedupeConsoleTabs,
  normalizeConsoleTab,
  parseConsoleTabParam,
  CONSOLE_EMPTY_STATE,
  OVERVIEW_CARDS,
  OVERVIEW_CARD_CONFIG,
  type ConsoleTab,
} from "@/lib/tenant-admin-console-config";
import { useAppAuth } from "@/lib/auth";
import {
  canViewTenantConsoleTab,
  canPerformPlatformAction,
  hasPlatformPermissionClient,
  hasAnyPlatformPermissionClient,
} from "@/lib/platform-access";
import { PlatformAccessDenied } from "@/components/platform-permission-route";
import { TenantConsoleTabBar } from "@/components/tenant/TenantConsoleTabBar";

// -----------------------------------------------------------------------------
// Safety contract (import-time validation - fails loudly if contract broken)
// -----------------------------------------------------------------------------

if (
  !TENANT_REGISTRY_SAFETY_CONTRACT.readOnly ||
  !TENANT_REGISTRY_SAFETY_CONTRACT.noMutationControls ||
  !TENANT_REGISTRY_SAFETY_CONTRACT.superAdminOnly
) {
  throw new Error("TENANT_REGISTRY_SAFETY_CONTRACT violated - read-only contract broken");
}
if (
  !ENTITLEMENT_SAFETY_CONTRACT.noPaymentProcessing ||
  !ENTITLEMENT_SAFETY_CONTRACT.noAutoWorkspaceSuspension ||
  !ENTITLEMENT_SAFETY_CONTRACT.noSuperAdminGovernanceExposure
) {
  throw new Error("ENTITLEMENT_SAFETY_CONTRACT violated - safety properties must all be true");
}
if (
  !USAGE_SAFETY_CONTRACT.superAdminOnly ||
  !USAGE_SAFETY_CONTRACT.readOnly ||
  !USAGE_SAFETY_CONTRACT.noAutoWorkspaceSuspension
) {
  throw new Error("USAGE_SAFETY_CONTRACT violated - usage intelligence is read-only and super-admin only");
}
if (
  !RENEWAL_INTELLIGENCE_SAFETY_CONTRACT.superAdminOnly ||
  !RENEWAL_INTELLIGENCE_SAFETY_CONTRACT.readOnly ||
  !RENEWAL_INTELLIGENCE_SAFETY_CONTRACT.noAutoWorkspaceSuspension ||
  !RENEWAL_INTELLIGENCE_SAFETY_CONTRACT.recommendationsOnly
) {
  throw new Error("RENEWAL_INTELLIGENCE_SAFETY_CONTRACT violated - renewal intelligence must be read-only, super-admin only, and recommendations-only");
}
if (
  !TENANT_HEALTH_SAFETY_CONTRACT.superAdminOnly ||
  !TENANT_HEALTH_SAFETY_CONTRACT.readOnly ||
  !TENANT_HEALTH_SAFETY_CONTRACT.noAutoWorkspaceSuspension ||
  !TENANT_HEALTH_SAFETY_CONTRACT.recommendationsOnly ||
  !TENANT_HEALTH_SAFETY_CONTRACT.noDestructiveTenantActions
) {
  throw new Error("TENANT_HEALTH_SAFETY_CONTRACT violated - tenant health must be read-only, super-admin only, and have no destructive actions");
}
if (
  !TENANT_ADMIN_CONSOLE_SAFETY_CONTRACT.superAdminOnly ||
  !TENANT_ADMIN_CONSOLE_SAFETY_CONTRACT.readOnlyOverview ||
  !TENANT_ADMIN_CONSOLE_SAFETY_CONTRACT.noPaymentProcessing ||
  !TENANT_ADMIN_CONSOLE_SAFETY_CONTRACT.noAutoWorkspaceSuspension ||
  !TENANT_ADMIN_CONSOLE_SAFETY_CONTRACT.noDestructiveTenantActions ||
  !TENANT_ADMIN_CONSOLE_SAFETY_CONTRACT.preservesExistingSafetyContracts
) {
  throw new Error("TENANT_ADMIN_CONSOLE_SAFETY_CONTRACT violated - console must be read-only overview, super-admin only, with no destructive actions");
}

// -----------------------------------------------------------------------------
// Small helpers
// -----------------------------------------------------------------------------

function cn(...classes: (string | undefined | false | null)[]) {
  return classes.filter(Boolean).join(" ");
}

function formatDate(iso: string | null): string {
  if (!iso) return TENANT_REGISTRY_EMPTY_STATE.unknownActivity;
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function TenantStatusBadge({ status }: { status: string }) {
  const cfg = TENANT_STATUS_MAP[status as keyof typeof TENANT_STATUS_MAP];
  if (!cfg) return <span className="text-xs text-muted-foreground">{status}</span>;
  return (
    <span
      className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium", cfg.badgeClass)}
      title={cfg.description}
    >
      {cfg.label}
    </span>
  );
}

function SubscriptionBadge({ status }: { status: string }) {
  const cfg = SUBSCRIPTION_STATUS_MAP[status as keyof typeof SUBSCRIPTION_STATUS_MAP];
  if (!cfg) return <span className="text-xs text-muted-foreground">{TENANT_REGISTRY_EMPTY_STATE.noSubscription}</span>;
  return (
    <span
      className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium", cfg.badgeClass)}
      title={cfg.description}
    >
      {cfg.label}
    </span>
  );
}

function RiskBadge({ level }: { level: string }) {
  const cfg = RISK_LEVEL_MAP[level as keyof typeof RISK_LEVEL_MAP];
  if (!cfg) return <span className="text-xs text-muted-foreground">{TENANT_REGISTRY_EMPTY_STATE.unknownRisk}</span>;
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium", cfg.badgeClass)}
      title={cfg.description}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full", cfg.dotClass)} />
      {cfg.label}
    </span>
  );
}

// -----------------------------------------------------------------------------
// P13-B - Lifecycle Control Panel
// -----------------------------------------------------------------------------

function LifecycleControlPanel({ tenant, canWrite = true }: { tenant: PlatformTenantProfile; canWrite?: boolean }) {
  const currentState   = deriveLifecycleStateFromWorkspaceStatus(tenant.workspaceStatus);
  const allowedActions = getAllowedActionsFromState(currentState);

  const [form, setForm] = useState<LifecycleFormState>({
    action:       null,
    reason:       "",
    internalNote: "",
    confirmed:    false,
  });

  const { mutate, isPending, error: mutationError, isSuccess } = useWorkspaceLifecycleTransition();

  function openAction(action: WorkspaceLifecycleAction) {
    setForm({ action, reason: "", internalNote: "", confirmed: false });
  }

  function closeModal() {
    if (isPending) return;
    setForm(f => ({ ...f, action: null }));
  }

  function handleSubmit() {
    if (!form.action || !isLifecycleFormValid(form) || isPending) return;
    mutate(
      {
        tenantId:     tenant.tenantId,
        action:       form.action,
        reason:       form.reason.trim(),
        internalNote: form.internalNote.trim() || undefined,
        confirmation: true,
      },
      { onSuccess: () => setForm({ action: null, reason: "", internalNote: "", confirmed: false }) },
    );
  }

  const modalCfg    = form.action ? LIFECYCLE_ACTION_CONFIG[form.action] : null;
  const severityCfg = modalCfg   ? LIFECYCLE_SEVERITY_STYLE[modalCfg.severity] : null;
  const canSubmit   = isLifecycleFormValid(form) && !isPending;

  const charsLeft = form.reason.trim().length < REASON_MIN_LENGTH
    ? REASON_MIN_LENGTH - form.reason.trim().length
    : 0;

  return (
    <div data-testid={`lifecycle-controls-${tenant.tenantId}`}>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        Lifecycle Controls
      </p>

      {isSuccess && !form.action && (
        <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300">
          <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
          {LIFECYCLE_EMPTY_STATE.transitionSuccess}
        </div>
      )}

      {!canWrite ? (
        <PlatformAccessDenied compact requiredPermission="tenants.lifecycle.update" />
      ) : allowedActions.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">{LIFECYCLE_EMPTY_STATE.noActionsAvailable}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {allowedActions.map(action => {
            const cfg = LIFECYCLE_ACTION_CONFIG[action];
            return (
              <button
                key={action}
                type="button"
                onClick={() => openAction(action)}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors",
                  cfg.buttonClass,
                )}
                data-testid={`lifecycle-action-${action}-${tenant.tenantId}`}
                title={cfg.description}
              >
                {cfg.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
        <Info className="w-3 h-3 shrink-0 mt-0.5" />
        <span>Controlled transitions only - all changes are audited. No deletion, billing, or automated enforcement.</span>
      </div>

      <Dialog open={form.action !== null} onOpenChange={open => { if (!open) closeModal(); }}>
        <DialogContent className="sm:max-w-md">
          {modalCfg && severityCfg && (
            <>
              <DialogHeader>
                <DialogTitle className={cn("flex items-center gap-2", severityCfg.headerClass)}>
                  {modalCfg.label} Workspace
                </DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground">
                  {modalCfg.description}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-1">
                <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Workspace: </span>
                  <span className="font-medium">{tenant.workspaceName}</span>
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    Reason <span className="text-destructive">*</span>
                    <span className="text-muted-foreground font-normal ml-1">(min {REASON_MIN_LENGTH} chars)</span>
                  </label>
                  <textarea
                    className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                    placeholder="Explain why you are performing this action..."
                    value={form.reason}
                    onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                    disabled={isPending}
                    data-testid="lifecycle-modal-reason"
                  />
                  {form.reason.length > 0 && charsLeft > 0 && (
                    <p className="text-xs text-destructive mt-1">
                      {charsLeft} more character{charsLeft !== 1 ? "s" : ""} required
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    Internal note <span className="font-normal">(optional)</span>
                  </label>
                  <textarea
                    className="w-full min-h-[56px] rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                    placeholder="Optional internal context for audit record..."
                    value={form.internalNote}
                    onChange={e => setForm(f => ({ ...f, internalNote: e.target.value }))}
                    disabled={isPending}
                    data-testid="lifecycle-modal-note"
                  />
                </div>

                <div className={cn(
                  "flex items-start gap-3 p-3 rounded-md border text-sm",
                  modalCfg.severity === "critical"
                    ? "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800"
                    : modalCfg.severity === "warning"
                    ? "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800"
                    : "bg-muted/40 border-border",
                )}>
                  <input
                    type="checkbox"
                    id={`confirm-lc-${tenant.tenantId}`}
                    checked={form.confirmed}
                    onChange={e => setForm(f => ({ ...f, confirmed: e.target.checked }))}
                    disabled={isPending}
                    className="mt-0.5 h-4 w-4 rounded border border-input cursor-pointer accent-primary"
                    data-testid="lifecycle-modal-confirm-checkbox"
                  />
                  <label
                    htmlFor={`confirm-lc-${tenant.tenantId}`}
                    className="text-xs cursor-pointer leading-relaxed"
                  >
                    {modalCfg.confirmationPrompt}
                  </label>
                </div>

                {mutationError && (
                  <div className="flex items-start gap-2 px-3 py-2 rounded bg-destructive/10 border border-destructive/20 text-xs text-destructive">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    {mutationError instanceof Error
                      ? mutationError.message
                      : LIFECYCLE_EMPTY_STATE.transitionError}
                  </div>
                )}
              </div>

              <DialogFooter className="gap-2 sm:gap-2">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={isPending}
                  className="inline-flex items-center px-4 py-2 rounded text-sm font-medium border border-border bg-background hover:bg-muted transition-colors disabled:opacity-50"
                  data-testid="lifecycle-modal-cancel"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  className={cn(
                    "inline-flex items-center gap-2 px-4 py-2 rounded text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
                    modalCfg.buttonClass,
                  )}
                  data-testid="lifecycle-modal-submit"
                >
                  {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {isPending ? "Applying..." : `Confirm ${modalCfg.label}`}
                </button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// -----------------------------------------------------------------------------
// P13-C - Subscription Management Panel
// -----------------------------------------------------------------------------

void SUBSCRIPTION_SAFETY_CONTRACT; // referenced to satisfy TS unused-import check

const EMPTY_SUB_FORM: SubscriptionFormState = {
  planCode:             "",
  subscriptionStatus:   "",
  billingPeriodStart:   "",
  billingPeriodEnd:     "",
  renewalDueAt:         "",
  trialStartedAt:       "",
  trialEndsAt:          "",
  gracePeriodStartedAt: "",
  gracePeriodEndsAt:    "",
  cancelledAt:          "",
  suspendedAt:          "",
  reason:               "",
  confirmation:         false,
};

function toFormDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(0, 16); // "YYYY-MM-DDTHH:mm"
}

function SubscriptionManagementPanel({ tenant, canWrite = true }: { tenant: PlatformTenantProfile; canWrite?: boolean }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm]           = useState<SubscriptionFormState>(EMPTY_SUB_FORM);

  const { mutate, isPending, error: mutationError, isSuccess, reset } = useUpdateTenantSubscription();

  function openModal() {
    setForm({
      planCode:             tenant.planCode             ?? "",
      subscriptionStatus:   tenant.subscriptionStatus   === "unknown" ? "" : tenant.subscriptionStatus,
      billingPeriodStart:   toFormDate(tenant.billingPeriodStart),
      billingPeriodEnd:     toFormDate(tenant.billingPeriodEnd),
      renewalDueAt:         toFormDate(tenant.renewalDueAt),
      trialStartedAt:       "",
      trialEndsAt:          toFormDate(tenant.trialEndsAt),
      gracePeriodStartedAt: "",
      gracePeriodEndsAt:    toFormDate(tenant.gracePeriodEndsAt),
      cancelledAt:          "",
      suspendedAt:          "",
      reason:               "",
      confirmation:         false,
    });
    reset();
    setModalOpen(true);
  }

  function closeModal() {
    if (isPending) return;
    setModalOpen(false);
  }

  function handleSubmit() {
    if (!isSubscriptionFormValid(form) || isPending) return;

    const toIso = (v: string) => v ? new Date(v).toISOString() : null;

    mutate(
      {
        tenantId:             tenant.tenantId,
        planCode:             form.planCode             || undefined,
        subscriptionStatus:   form.subscriptionStatus   || undefined,
        billingPeriodStart:   toIso(form.billingPeriodStart),
        billingPeriodEnd:     toIso(form.billingPeriodEnd),
        renewalDueAt:         toIso(form.renewalDueAt),
        trialStartedAt:       toIso(form.trialStartedAt),
        trialEndsAt:          toIso(form.trialEndsAt),
        gracePeriodStartedAt: toIso(form.gracePeriodStartedAt),
        gracePeriodEndsAt:    toIso(form.gracePeriodEndsAt),
        cancelledAt:          toIso(form.cancelledAt),
        suspendedAt:          toIso(form.suspendedAt),
        reason:               form.reason.trim(),
        confirmation:         true,
      },
      { onSuccess: () => setModalOpen(false) },
    );
  }

  const formError  = getSubscriptionFormError(form);
  const canSubmit  = isSubscriptionFormValid(form) && !isPending;
  const charsLeft  = Math.max(0, SUB_REASON_MIN_LENGTH - form.reason.trim().length);

  const planCfg = tenant.planCode
    ? PLAN_CODE_CONFIG[tenant.planCode as keyof typeof PLAN_CODE_CONFIG] ?? null
    : null;

  const statusCfg = SUBSCRIPTION_STATUS_CONFIG[tenant.subscriptionStatus as keyof typeof SUBSCRIPTION_STATUS_CONFIG] ?? null;

  return (
    <div data-testid={`subscription-panel-${tenant.tenantId}`}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Subscription Management
        </p>
        {canWrite && (
          <button
            type="button"
            onClick={openModal}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors border border-primary/20"
            data-testid={`subscription-edit-btn-${tenant.tenantId}`}
          >
            <CreditCard className="w-3 h-3" />
            Edit Subscription Metadata
          </button>
        )}
      </div>

      {isSuccess && !modalOpen && (
        <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          Subscription metadata updated successfully. Changes audit-logged.
        </div>
      )}

      <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 text-sm">
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">Plan</dt>
          <dd className="font-medium">
            {planCfg
              ? <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium", planCfg.badgeClass)}>{planCfg.name}</span>
              : <span className="text-muted-foreground text-xs italic">{SUBSCRIPTION_EMPTY_STATE.noPlan}</span>
            }
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">Status (derived)</dt>
          <dd>
            {statusCfg
              ? <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium", statusCfg.badgeClass)}>{statusCfg.label}</span>
              : <span className="text-muted-foreground text-xs italic">{SUBSCRIPTION_EMPTY_STATE.noSubscription}</span>
            }
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">Period start</dt>
          <dd className="text-xs">{formatDate(tenant.billingPeriodStart)}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">Period end</dt>
          <dd className="text-xs">{formatDate(tenant.billingPeriodEnd)}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">Renewal due</dt>
          <dd className="text-xs">{formatDate(tenant.renewalDueAt)}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">Trial ends</dt>
          <dd className="text-xs">{formatDate(tenant.trialEndsAt)}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">Grace period ends</dt>
          <dd className="text-xs">{formatDate(tenant.gracePeriodEndsAt)}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">Renewal signal</dt>
          <dd className="text-xs">
            {tenant.riskSignalSummary.renewalApproaching
              ? <span className="text-amber-600 dark:text-amber-400 font-medium">Approaching</span>
              : tenant.riskSignalSummary.subscriptionExpired
              ? <span className="text-red-600 dark:text-red-400 font-medium">Expired</span>
              : tenant.riskSignalSummary.gracePeriodActive
              ? <span className="text-orange-600 dark:text-orange-400 font-medium">Grace period</span>
              : <span className="text-muted-foreground">None</span>
            }
          </dd>
        </div>
      </dl>

      <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Info className="w-3 h-3 shrink-0" />
        <span>Metadata only - {SUBSCRIPTION_EMPTY_STATE.noMetadata}. Changes are audit-logged.</span>
      </div>

      <Dialog open={modalOpen} onOpenChange={open => { if (!open) closeModal(); }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <CreditCard className="w-4 h-4 text-primary" />
              Edit Subscription Metadata
            </DialogTitle>
            <DialogDescription>
              Update subscription metadata for <strong>{tenant.workspaceName}</strong>.
              No payment processing - metadata only. All changes are audit-logged.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {/* Plan & Status */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Plan</label>
                <select
                  className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  value={form.planCode}
                  onChange={e => setForm(f => ({ ...f, planCode: e.target.value }))}
                  disabled={isPending}
                  data-testid="sub-form-planCode"
                >
                  <option value="">- no plan -</option>
                  {ALL_PLAN_CODES.map(code => (
                    <option key={code} value={code}>{PLAN_CODE_CONFIG[code].name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Status override</label>
                <select
                  className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  value={form.subscriptionStatus}
                  onChange={e => setForm(f => ({ ...f, subscriptionStatus: e.target.value }))}
                  disabled={isPending}
                  data-testid="sub-form-subscriptionStatus"
                >
                  <option value="">- derive from dates -</option>
                  {ALL_SUBSCRIPTION_STATUSES.filter(s => s !== "unknown").map(s => (
                    <option key={s} value={s}>{SUBSCRIPTION_STATUS_CONFIG[s].label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Billing Period */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Billing Period</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Period start</label>
                  <input type="datetime-local" className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring" value={form.billingPeriodStart} onChange={e => setForm(f => ({ ...f, billingPeriodStart: e.target.value }))} disabled={isPending} data-testid="sub-form-billingPeriodStart" />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Period end</label>
                  <input type="datetime-local" className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring" value={form.billingPeriodEnd} onChange={e => setForm(f => ({ ...f, billingPeriodEnd: e.target.value }))} disabled={isPending} data-testid="sub-form-billingPeriodEnd" />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Renewal due at</label>
                  <input type="datetime-local" className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring" value={form.renewalDueAt} onChange={e => setForm(f => ({ ...f, renewalDueAt: e.target.value }))} disabled={isPending} data-testid="sub-form-renewalDueAt" />
                </div>
              </div>
            </div>

            {/* Trial Window */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Trial Window</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Trial started at</label>
                  <input type="datetime-local" className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring" value={form.trialStartedAt} onChange={e => setForm(f => ({ ...f, trialStartedAt: e.target.value }))} disabled={isPending} data-testid="sub-form-trialStartedAt" />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Trial ends at</label>
                  <input type="datetime-local" className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring" value={form.trialEndsAt} onChange={e => setForm(f => ({ ...f, trialEndsAt: e.target.value }))} disabled={isPending} data-testid="sub-form-trialEndsAt" />
                </div>
              </div>
            </div>

            {/* Grace Period */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Grace Period</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Grace started at</label>
                  <input type="datetime-local" className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring" value={form.gracePeriodStartedAt} onChange={e => setForm(f => ({ ...f, gracePeriodStartedAt: e.target.value }))} disabled={isPending} data-testid="sub-form-gracePeriodStartedAt" />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Grace ends at</label>
                  <input type="datetime-local" className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring" value={form.gracePeriodEndsAt} onChange={e => setForm(f => ({ ...f, gracePeriodEndsAt: e.target.value }))} disabled={isPending} data-testid="sub-form-gracePeriodEndsAt" />
                </div>
              </div>
            </div>

            {/* Lifecycle dates */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Lifecycle Timestamps</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Cancelled at</label>
                  <input type="datetime-local" className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring" value={form.cancelledAt} onChange={e => setForm(f => ({ ...f, cancelledAt: e.target.value }))} disabled={isPending} data-testid="sub-form-cancelledAt" />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Suspended at</label>
                  <input type="datetime-local" className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring" value={form.suspendedAt} onChange={e => setForm(f => ({ ...f, suspendedAt: e.target.value }))} disabled={isPending} data-testid="sub-form-suspendedAt" />
                </div>
              </div>
            </div>

            {/* Reason */}
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">
                Reason <span className="text-destructive">*</span>
                <span className="text-muted-foreground font-normal ml-1">(min {SUB_REASON_MIN_LENGTH} chars)</span>
              </label>
              <textarea
                className="w-full min-h-[72px] rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                placeholder="Explain why you are updating this subscription metadata..."
                value={form.reason}
                onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                disabled={isPending}
                data-testid="sub-form-reason"
              />
              {form.reason.length > 0 && charsLeft > 0 && (
                <p className="text-xs text-destructive mt-1">
                  {charsLeft} more character{charsLeft !== 1 ? "s" : ""} required
                </p>
              )}
            </div>

            {/* Confirmation */}
            <div className="flex items-start gap-3 p-3 rounded-md border border-primary/20 bg-primary/5 text-sm">
              <input
                type="checkbox"
                id={`sub-confirm-${tenant.tenantId}`}
                checked={form.confirmation}
                onChange={e => setForm(f => ({ ...f, confirmation: e.target.checked }))}
                disabled={isPending}
                className="mt-0.5 h-4 w-4 rounded border border-input cursor-pointer accent-primary"
                data-testid="sub-form-confirm"
              />
              <label htmlFor={`sub-confirm-${tenant.tenantId}`} className="text-xs cursor-pointer leading-relaxed">
                I confirm this is a metadata-only update. No payments are processed, no invoices generated, and no workspace access is automatically changed.
              </label>
            </div>

            {formError && form.reason.length > 0 && !form.confirmation && (
              <p className="text-xs text-muted-foreground italic">{formError}</p>
            )}

            {mutationError && (
              <div className="flex items-start gap-2 px-3 py-2 rounded bg-destructive/10 border border-destructive/20 text-xs text-destructive">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                {mutationError instanceof Error ? mutationError.message : "An error occurred. Please try again."}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <button
              type="button"
              onClick={closeModal}
              disabled={isPending}
              className="inline-flex items-center px-4 py-2 rounded text-sm font-medium border border-border bg-background hover:bg-muted transition-colors disabled:opacity-50"
              data-testid="sub-form-cancel"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="inline-flex items-center gap-2 px-4 py-2 rounded text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="sub-form-submit"
            >
              {isPending && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              {isPending ? "Saving..." : "Save Subscription Metadata"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// -----------------------------------------------------------------------------
// P13-D - Entitlement & Module Access Panel
// -----------------------------------------------------------------------------

const EMPTY_ENT_FORM: EntitlementOverrideFormState = {
  moduleCode:   "",
  overrideType: "",
  limitCode:    "",
  limitValue:   "",
  reason:       "",
  confirmation: false,
};

function EntitlementPanel({ tenant, canWrite = true }: { tenant: PlatformTenantProfile; canWrite?: boolean }) {
  const [form, setForm] = useState<EntitlementOverrideFormState>(EMPTY_ENT_FORM);
  const [open, setOpen]  = useState(false);

  const { data, isLoading, isError }                             = useTenantEntitlements(tenant.tenantId);
  const { mutate, isPending, error: mutationError, isSuccess }   = useUpdateTenantEntitlementOverrides();

  const profile   = data?.entitlementProfile;
  const overrides = data?.overrides ?? [];

  const formError = getEntitlementOverrideFormError(form);
  const canSubmit = !formError && !isPending;

  function openModal() {
    setForm(EMPTY_ENT_FORM);
    setOpen(true);
  }
  function closeModal() {
    if (isPending) return;
    setOpen(false);
  }
  function handleSubmit() {
    if (!canSubmit) return;
    mutate(
      {
        tenantId: tenant.tenantId,
        overrides: [{
          moduleCode:   form.moduleCode,
          overrideType: form.overrideType,
          limitCode:    form.overrideType === "limit_override" ? (form.limitCode || null) : null,
          limitValue:   form.overrideType === "limit_override" && form.limitValue !== ""
            ? parseFloat(form.limitValue) : null,
          reason: form.reason.trim(),
        }],
        confirmation: true,
      },
      { onSuccess: () => { setOpen(false); setForm(EMPTY_ENT_FORM); } },
    );
  }

  return (
    <div data-testid={`entitlement-panel-${tenant.tenantId}`}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Entitlements &amp; Module Access
        </p>
        {canWrite && (
          <button
            type="button"
            onClick={openModal}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-muted hover:bg-muted/80 border border-border transition-colors"
            data-testid={`entitlement-edit-${tenant.tenantId}`}
          >
            <Package className="w-3 h-3" />
            Add / Edit Override
          </button>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Loading entitlements...
        </div>
      )}
      {isError && (
        <p className="text-xs text-destructive">Failed to load entitlements.</p>
      )}

      {!isLoading && !isError && profile && (
        <>
          <div className="flex flex-wrap gap-3 mb-3 text-xs text-muted-foreground">
            <span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">{profile.enabledModules.length}</span> enabled
            </span>
            <span>
              <span className="font-semibold text-slate-500">{profile.disabledModules.length}</span> disabled
            </span>
            {overrides.length > 0 && (
              <span className="font-semibold text-amber-600 dark:text-amber-400">
                {overrides.length} custom override{overrides.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {profile.enabledModules.length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-muted-foreground mb-1.5">Enabled Modules</p>
              <div className="flex flex-wrap gap-1.5">
                {profile.enabledModules.map(code => {
                  const cfg = MODULE_REGISTRY_CONFIG[code as keyof typeof MODULE_REGISTRY_CONFIG];
                  return (
                    <span
                      key={code}
                      className={cn(
                        "text-xs px-2 py-0.5 rounded-full font-medium",
                        cfg?.enabledBadgeClass ?? "bg-emerald-100 text-emerald-800",
                      )}
                      title={cfg?.description}
                    >
                      {cfg?.label ?? code}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mb-3">
            <p className="text-xs text-muted-foreground mb-1.5">Key Limits</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {(["seats", "storage_gb", "monthly_api_calls", "workflows"] as const).map(code => {
                const cfg = FEATURE_LIMIT_CONFIG[code];
                const val = profile.limits[code];
                return (
                  <div key={code} className="rounded bg-muted/40 px-2 py-1.5 text-xs">
                    <p className="text-muted-foreground truncate">{cfg.label}</p>
                    <p className="font-medium text-foreground">
                      {val === null ? "Unlimited" : `${val.toLocaleString()} ${cfg.unit}`}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {overrides.length > 0 && (
            <div className="mb-2">
              <p className="text-xs text-muted-foreground mb-1.5">Custom Overrides</p>
              <div className="space-y-1">
                {overrides.map((ov, i) => {
                  const modCfg = MODULE_REGISTRY_CONFIG[ov.moduleCode as keyof typeof MODULE_REGISTRY_CONFIG];
                  const ovCfg  = OVERRIDE_TYPE_CONFIG[ov.overrideType as keyof typeof OVERRIDE_TYPE_CONFIG];
                  const limCfg = ov.limitCode
                    ? FEATURE_LIMIT_CONFIG[ov.limitCode as keyof typeof FEATURE_LIMIT_CONFIG]
                    : null;
                  return (
                    <div
                      key={i}
                      className="flex flex-wrap items-center gap-2 text-xs rounded bg-muted/30 px-2 py-1.5"
                    >
                      <span className="font-medium text-foreground">{modCfg?.label ?? ov.moduleCode}</span>
                      <span className={cn("px-1.5 py-0.5 rounded-full font-medium text-xs", ovCfg?.badgeClass ?? "bg-amber-100 text-amber-800")}>
                        {ovCfg?.label ?? ov.overrideType}
                      </span>
                      {limCfg && (
                        <span className="text-muted-foreground">
                          {limCfg.label}: {ov.limitValue === null ? "unlimited" : ov.limitValue}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {profile.enabledModules.length === 0 && overrides.length === 0 && (
            <p className="text-xs text-muted-foreground italic">{ENTITLEMENT_EMPTY_STATE.noPlan}</p>
          )}
        </>
      )}

      {isSuccess && !open && (
        <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          Override saved and audited.
        </div>
      )}

      <div className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
        <Info className="w-3 h-3 shrink-0 mt-0.5" />
        <span>{ENTITLEMENT_EMPTY_STATE.entitlementOnly}</span>
      </div>

      <Dialog open={open} onOpenChange={o => { if (!o) closeModal(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add / Edit Entitlement Override</DialogTitle>
            <DialogDescription>
              Override module access or feature limits for <strong>{tenant.workspaceName}</strong>.
              All changes are audited. No billing, payment, or enforcement logic.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">
                Module <span className="text-destructive">*</span>
              </label>
              <Select
                value={form.moduleCode || "_none"}
                onValueChange={v => setForm(f => ({ ...f, moduleCode: v === "_none" ? "" : v }))}
              >
                <SelectTrigger className="h-9 text-sm" data-testid="ent-module-select">
                  <SelectValue placeholder="Select module..." />
                </SelectTrigger>
                <SelectContent>
                  {ALL_MODULE_CODES.map(code => (
                    <SelectItem key={code} value={code}>
                      {MODULE_REGISTRY_CONFIG[code].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">
                Override Type <span className="text-destructive">*</span>
              </label>
              <Select
                value={form.overrideType || "_none"}
                onValueChange={v => setForm(f => ({
                  ...f, overrideType: v === "_none" ? "" : v, limitCode: "", limitValue: "",
                }))}
              >
                <SelectTrigger className="h-9 text-sm" data-testid="ent-type-select">
                  <SelectValue placeholder="Select type..." />
                </SelectTrigger>
                <SelectContent>
                  {ALL_OVERRIDE_TYPES.map(type => (
                    <SelectItem key={type} value={type}>
                      {OVERRIDE_TYPE_CONFIG[type].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.overrideType && OVERRIDE_TYPE_CONFIG[form.overrideType as keyof typeof OVERRIDE_TYPE_CONFIG] && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {OVERRIDE_TYPE_CONFIG[form.overrideType as keyof typeof OVERRIDE_TYPE_CONFIG].description}
                </p>
              )}
            </div>

            {form.overrideType === "limit_override" && (
              <>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    Limit <span className="text-destructive">*</span>
                  </label>
                  <Select
                    value={form.limitCode || "_none"}
                    onValueChange={v => setForm(f => ({ ...f, limitCode: v === "_none" ? "" : v }))}
                  >
                    <SelectTrigger className="h-9 text-sm" data-testid="ent-limitcode-select">
                      <SelectValue placeholder="Select limit..." />
                    </SelectTrigger>
                    <SelectContent>
                      {ALL_LIMIT_CODES.map(code => (
                        <SelectItem key={code} value={code}>
                          {FEATURE_LIMIT_CONFIG[code].label} ({FEATURE_LIMIT_CONFIG[code].unit})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    Value
                    <span className="text-muted-foreground font-normal ml-1">(blank = unlimited)</span>
                  </label>
                  <input
                    type="number"
                    min={0}
                    placeholder="e.g. 500"
                    value={form.limitValue}
                    onChange={e => setForm(f => ({ ...f, limitValue: e.target.value }))}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    data-testid="ent-limitvalue-input"
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">
                Reason <span className="text-destructive">*</span>
                <span className="text-muted-foreground font-normal ml-1">(min 10 chars)</span>
              </label>
              <textarea
                className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                placeholder="Justify this entitlement override..."
                value={form.reason}
                onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                data-testid="ent-reason-textarea"
              />
              {form.reason.length > 0 && form.reason.trim().length < 10 && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {10 - form.reason.trim().length} more character{10 - form.reason.trim().length !== 1 ? "s" : ""} needed
                </p>
              )}
            </div>

            <label className="flex items-start gap-2.5 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.confirmation}
                onChange={e => setForm(f => ({ ...f, confirmation: e.target.checked }))}
                className="mt-0.5 shrink-0"
                data-testid="ent-confirm-checkbox"
              />
              <span className="text-sm text-foreground">
                I confirm this entitlement override for <strong>{tenant.workspaceName}</strong>.
                All changes are audit-logged and require super-admin authority.
              </span>
            </label>

            {mutationError && (
              <div className="flex items-start gap-2 px-3 py-2 rounded bg-destructive/10 border border-destructive/20 text-xs text-destructive">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                {mutationError instanceof Error ? mutationError.message : "An error occurred. Please try again."}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <button
              type="button"
              onClick={closeModal}
              disabled={isPending}
              className="inline-flex items-center px-4 py-2 rounded text-sm font-medium border border-border bg-background hover:bg-muted transition-colors disabled:opacity-50"
              data-testid="ent-form-cancel"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="inline-flex items-center gap-2 px-4 py-2 rounded text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="ent-form-submit"
            >
              {isPending && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              {isPending ? "Saving..." : "Save Override"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Detail Drawer / Expansion Row
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// P13-E - Usage & Capacity Intelligence Panel
// -----------------------------------------------------------------------------

function UsagePanel({ tenant }: { tenant: PlatformTenantProfile }) {
  const { data, isLoading, isError } = useTenantUsage(tenant.tenantId);

  const usageProfile = data?.usageProfile;
  const warnings     = data?.warnings ?? [];
  const riskLevel    = (usageProfile?.capacityRiskLevel ?? "unknown") as CapacityRiskLevel;
  const riskCfg      = CAPACITY_RISK_CONFIG[riskLevel] ?? CAPACITY_RISK_CONFIG.unknown;

  return (
    <div data-testid={`usage-panel-${tenant.tenantId}`} className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <BarChart3 className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-semibold text-foreground">Usage &amp; Capacity Intelligence</span>
        {usageProfile && (
          <>
            <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium", riskCfg.badgeClass)}>
              Capacity: {riskCfg.label}
            </span>
            {usageProfile.warningCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                <AlertTriangle className="w-3 h-3" />
                {usageProfile.warningCount} approaching
              </span>
            )}
            {usageProfile.exceededCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200">
                <AlertTriangle className="w-3 h-3" />
                {usageProfile.exceededCount} exceeded
              </span>
            )}
            {usageProfile.unknownCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                {usageProfile.unknownCount} unknown
              </span>
            )}
          </>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>{USAGE_EMPTY_STATE.loading}</span>
        </div>
      )}

      {isError && !isLoading && (
        <div className="flex items-center gap-2 text-sm text-destructive py-2">
          <AlertTriangle className="w-4 h-4" />
          <span>Unable to load usage data.</span>
        </div>
      )}

      {usageProfile && (
        <>
          {warnings.length > 0 && (
            <div className="flex flex-col gap-1 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md">
              <p className="text-xs font-semibold text-amber-800 dark:text-amber-200 mb-1">Capacity Warnings</p>
              {warnings.map((w, i) => (
                <p key={i} className="text-xs text-amber-700 dark:text-amber-300 flex items-start gap-1.5">
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />{w}
                </p>
              ))}
            </div>
          )}

          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Metric</th>
                  <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Source</th>
                  <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Usage</th>
                  <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Limit</th>
                  <th className="text-left px-3 py-2 font-semibold text-muted-foreground w-28">Utilisation</th>
                  <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {ALL_USAGE_METRIC_CODES.map(code => {
                  const row       = usageProfile.metrics.find(m => m.metricCode === code);
                  if (!row) return null;
                  const metricCfg = USAGE_METRIC_CONFIG[code as UsageMetricCode];
                  const statusCfg = USAGE_STATUS_CONFIG[row.status];
                  const srcCfg    = METRIC_SOURCE_CONFIG[row.sourceType];
                  const pct       = row.percentage !== null ? Math.round(row.percentage * 100) : null;
                  const barColor  = row.status === "exceeded"
                    ? "bg-red-500"
                    : row.status === "approaching"
                    ? "bg-amber-500"
                    : "bg-emerald-500";
                  const limitDisplay = row.limitValue !== null
                    ? String(row.limitValue)
                    : row.status === "unlimited" ? "unlimited" : "-";

                  return (
                    <tr key={code} className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-3 py-2 font-medium text-foreground">
                        {metricCfg?.label ?? code}
                        <span className="ml-1 text-muted-foreground font-normal">({metricCfg?.unit})</span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium", srcCfg?.badgeClass)}>
                          {srcCfg?.label ?? row.sourceType}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {row.usageValue !== null ? row.usageValue.toLocaleString() : "-"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {limitDisplay}
                      </td>
                      <td className="px-3 py-2">
                        {pct !== null ? (
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden flex-shrink-0">
                              <div
                                className={cn("h-full rounded-full transition-all", barColor)}
                                style={{ width: `${Math.min(pct, 100)}%` }}
                              />
                            </div>
                            <span className="text-muted-foreground">{pct}%</span>
                          </div>
                        ) : <span className="text-muted-foreground">-</span>}
                      </td>
                      <td className="px-3 py-2">
                        <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium", statusCfg?.badgeClass)}>
                          {statusCfg?.label ?? row.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
            <Info className="w-3 h-3 shrink-0" />
            <span>Read-only capacity view. Unavailable metrics have no tracking implementation yet.</span>
          </div>
        </>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// P13-G - TenantHealthPanel
// Read-only tenant health & operational monitoring for super-admins.
// No suspend/charge/lock/enforce/email buttons anywhere in this component.
// -----------------------------------------------------------------------------

const COMPONENT_STATUS_STYLE: Record<string, string> = {
  ok:        "text-green-700 dark:text-green-400",
  attention: "text-yellow-700 dark:text-yellow-400",
  warning:   "text-orange-700 dark:text-orange-400",
  critical:  "text-red-700 dark:text-red-400",
  unknown:   "text-muted-foreground",
};

const COMPONENT_STATUS_LABEL: Record<string, string> = {
  ok:        "OK",
  attention: "Attention",
  warning:   "Warning",
  critical:  "Critical",
  unknown:   "Unknown",
};

function TenantHealthPanel({ tenant }: { tenant: PlatformTenantProfile }) {
  const { data, isLoading, isError } = useTenantHealth(tenant.tenantId);

  const profile     = data?.healthProfile;
  const statusCfg   = profile ? TENANT_HEALTH_STATUS_CONFIG[profile.healthStatus as TenantHealthStatus]   : null;
  const riskCfg     = profile ? TENANT_HEALTH_RISK_CONFIG[profile.riskLevel as TenantHealthRiskLevel]     : null;
  const actionCfg   = profile ? TENANT_HEALTH_ACTION_CONFIG[profile.recommendedAction as RecommendedTenantHealthAction] : null;

  const componentEntries = profile
    ? (Object.entries(profile.components) as [string, { name: string; status: string; note: string }][])
    : [];

  return (
    <div className="space-y-4" data-testid="tenant-health-panel">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <Heart className="w-4 h-4 text-muted-foreground shrink-0" />
        <h4 className="font-semibold text-sm text-foreground">Tenant Health &amp; Operational Monitoring</h4>
        {statusCfg && (
          <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border", statusCfg.badgeClass)}>
            {statusCfg.label}
          </span>
        )}
        {riskCfg && (
          <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border", riskCfg.badgeClass)}>
            Risk: {riskCfg.label}
          </span>
        )}
        {actionCfg && profile?.recommendedAction !== "none" && (
          <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border", actionCfg.badgeClass)}>
            {actionCfg.label}
          </span>
        )}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>{TENANT_HEALTH_EMPTY_STATE.loading}</span>
        </div>
      )}

      {/* Error */}
      {isError && !isLoading && (
        <div className="flex items-center gap-2 text-sm text-destructive py-2">
          <AlertTriangle className="w-4 h-4" />
          <span>Failed to load tenant health data.</span>
        </div>
      )}

      {profile && !isLoading && (
        <div className="space-y-4">
          {/* Health summary text */}
          {profile.summary && (
            <p className="text-xs text-muted-foreground leading-relaxed">{profile.summary}</p>
          )}

          {/* Component health cards */}
          {componentEntries.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Component Health</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" data-testid="health-components">
                {componentEntries.map(([key, comp]) => (
                  <div key={key} className="bg-muted/30 rounded-lg px-3 py-2 flex flex-col gap-0.5">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{comp.name}</span>
                    <span className={cn("text-xs font-semibold", COMPONENT_STATUS_STYLE[comp.status] ?? "text-muted-foreground")}>
                      {COMPONENT_STATUS_LABEL[comp.status] ?? comp.status}
                    </span>
                    <span className="text-[10px] text-muted-foreground leading-tight">{comp.note}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Active health signals */}
          {profile.signals.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Health Signals</p>
              <div className="flex flex-wrap gap-1.5" data-testid="health-signals">
                {profile.signals.map(signal => {
                  const cfg = TENANT_HEALTH_SIGNAL_CONFIG[signal as TenantHealthSignalCode];
                  return (
                    <span
                      key={signal}
                      title={cfg?.description}
                      className={cn("inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-medium", cfg?.badgeClass ?? "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600")}
                    >
                      {cfg?.label ?? signal}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Recommended action description */}
          {actionCfg && profile.recommendedAction !== "none" && (
            <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/20 rounded-lg px-3 py-2">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{actionCfg.description}</span>
            </div>
          )}

          {/* Warnings */}
          {profile.warnings.length > 0 && (
            <div
              className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 space-y-1"
              data-testid="health-warnings"
            >
              {profile.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-amber-900 dark:text-amber-200">
                  <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5 text-amber-500" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          {/* No signals */}
          {profile.signals.length === 0 && (
            <p className="text-xs text-muted-foreground">{TENANT_HEALTH_EMPTY_STATE.noSignals}</p>
          )}

          {/* Safety notice */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1" data-testid="health-safety-notice">
            <ShieldCheck className="w-3 h-3 shrink-0" />
            <span>{TENANT_HEALTH_EMPTY_STATE.safetyNotice}</span>
          </div>
        </div>
      )}

      {/* No data */}
      {!profile && !isLoading && !isError && (
        <p className="text-xs text-muted-foreground">{TENANT_HEALTH_EMPTY_STATE.noData}</p>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// P13-I - TenantEvaluationPanel
// Advisory lifecycle evaluation engine - signals, severity, review eligibility.
// Super-admin visibility only. Read-only. No actions, no enforcement.
// -----------------------------------------------------------------------------

function TenantEvaluationPanel({ tenant }: { tenant: PlatformTenantProfile }) {
  const { data, isLoading, isError } = useTenantLifecycleEvaluation(tenant.tenantId);

  const profile    = data?.evaluationProfile;
  const severityCfg = profile
    ? LIFECYCLE_EVALUATION_SEVERITY_CONFIG[profile.severity as EvaluationSeverity]
    : null;
  const actionCfg  = profile
    ? LIFECYCLE_EVALUATION_ACTION_CONFIG[profile.recommendedAction as EvaluationRecommendedAction]
    : null;

  return (
    <div className="space-y-4" data-testid="tenant-evaluation-panel">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <ClipboardList className="w-4 h-4 text-muted-foreground shrink-0" />
        <h4 className="font-semibold text-sm text-foreground">Lifecycle Evaluation Engine</h4>
        {severityCfg && profile && (
          <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border", severityCfg.badgeClass)}>
            {severityCfg.label}
          </span>
        )}
        {actionCfg && profile?.recommendedAction !== "none" && (
          <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border", actionCfg.badgeClass)}>
            {actionCfg.label}
          </span>
        )}
        {profile?.reviewEligibility.manualReviewRequired && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-950 dark:text-rose-200 dark:border-rose-800">
            <AlertTriangle className="w-3 h-3" />
            Manual Review Required
          </span>
        )}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>{LIFECYCLE_EVALUATION_EMPTY_STATE.loading}</span>
        </div>
      )}

      {/* Error */}
      {isError && !isLoading && (
        <div className="flex items-center gap-2 text-sm text-destructive py-2">
          <AlertTriangle className="w-4 h-4" />
          <span>Failed to load lifecycle evaluation data.</span>
        </div>
      )}

      {profile && !isLoading && (
        <div className="space-y-4">
          {/* Summary */}
          {profile.summary && (
            <p className="text-xs text-muted-foreground leading-relaxed">{profile.summary}</p>
          )}

          {/* Review Eligibility Grid */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Review Eligibility</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="evaluation-review-eligibility">
              {REVIEW_ELIGIBILITY_CONFIG.map(cfg => {
                const eligible = profile.reviewEligibility[cfg.key as keyof typeof profile.reviewEligibility];
                return (
                  <div
                    key={cfg.key}
                    className={cn(
                      "rounded-lg px-3 py-2 flex flex-col gap-0.5 border",
                      eligible
                        ? cfg.key === "manualReviewRequired"
                          ? "bg-rose-50 border-rose-200 dark:bg-rose-950/30 dark:border-rose-800"
                          : "bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800"
                        : "bg-muted/30 border-transparent",
                    )}
                  >
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{cfg.label}</span>
                    <span className={cn(
                      "text-xs font-semibold",
                      eligible
                        ? cfg.key === "manualReviewRequired"
                          ? "text-rose-700 dark:text-rose-300"
                          : "text-amber-700 dark:text-amber-300"
                        : "text-muted-foreground",
                    )}>
                      {eligible ? "Eligible" : "-"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Active Evaluation Signals */}
          {profile.signals.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">
                Active Signals ({profile.signals.length})
              </p>
              <div className="flex flex-wrap gap-1.5" data-testid="evaluation-signals">
                {profile.signals.map(signal => {
                  const cfg = LIFECYCLE_EVALUATION_SIGNAL_CONFIG[signal as EvaluationSignalCode];
                  return (
                    <span
                      key={signal}
                      title={cfg?.description}
                      className={cn(
                        "inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-medium",
                        cfg?.badgeClass ?? "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600",
                      )}
                    >
                      {cfg?.label ?? signal}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Recommended action description */}
          {actionCfg && profile.recommendedAction !== "none" && (
            <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/20 rounded-lg px-3 py-2">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{actionCfg.description}</span>
            </div>
          )}

          {/* Warnings */}
          {profile.warnings.length > 0 && (
            <div
              className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 space-y-1"
              data-testid="evaluation-warnings"
            >
              {profile.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-amber-900 dark:text-amber-200">
                  <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5 text-amber-500" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          {/* No signals */}
          {profile.signals.length === 0 && (
            <p className="text-xs text-muted-foreground">{LIFECYCLE_EVALUATION_EMPTY_STATE.noSignals}</p>
          )}

          {/* Safety notice */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1" data-testid="evaluation-safety-notice">
            <ShieldCheck className="w-3 h-3 shrink-0" />
            <span>{LIFECYCLE_EVALUATION_EMPTY_STATE.safetyNotice}</span>
          </div>
        </div>
      )}

      {/* No data */}
      {!profile && !isLoading && !isError && (
        <p className="text-xs text-muted-foreground">{LIFECYCLE_EVALUATION_EMPTY_STATE.noData}</p>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// P13-F - RenewalIntelligencePanel
// Read-only renewal and grace period intelligence for super-admins.
// No suspend/charge/email/enforcement buttons anywhere in this component.
// -----------------------------------------------------------------------------

function RenewalIntelligencePanel({ tenant }: { tenant: PlatformTenantProfile }) {
  const { data, isLoading, isError } = useTenantRenewalIntelligence(tenant.tenantId);

  const profile       = data?.renewalProfile;
  const urgencyCfg    = profile ? RENEWAL_URGENCY_CONFIG[profile.urgency as RenewalUrgency] : null;
  const actionCfg     = profile ? RECOMMENDED_PLATFORM_ACTION_CONFIG[profile.recommendedAction as RecommendedPlatformAction] : null;

  return (
    <div className="space-y-3" data-testid="renewal-intelligence-panel">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <CreditCard className="w-4 h-4 text-muted-foreground shrink-0" />
        <h4 className="font-semibold text-sm text-foreground">Renewal &amp; Grace Intelligence</h4>
        {urgencyCfg && (
          <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold", urgencyCfg.badgeClass)}>
            {urgencyCfg.label}
          </span>
        )}
        {actionCfg && profile?.recommendedAction !== "none" && (
          <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium", actionCfg.badgeClass)}>
            {actionCfg.label}
          </span>
        )}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>{RENEWAL_EMPTY_STATE.loading}</span>
        </div>
      )}

      {/* Error */}
      {isError && !isLoading && (
        <div className="flex items-center gap-2 text-sm text-destructive py-2">
          <AlertTriangle className="w-4 h-4" />
          <span>Failed to load renewal intelligence data.</span>
        </div>
      )}

      {/* Main Content */}
      {profile && !isLoading && (
        <div className="space-y-3">
          {/* Signals */}
          {profile.signals.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Active Signals</p>
              <div className="flex flex-wrap gap-1.5" data-testid="renewal-signals">
                {profile.signals.map(signal => {
                  const cfg = RENEWAL_SIGNAL_CONFIG[signal as RenewalSignalCode];
                  return (
                    <span
                      key={signal}
                      title={cfg?.description}
                      className={cn("inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border", cfg?.badgeClass ?? "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600")}
                    >
                      {cfg?.label ?? signal}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Day counters */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div className="bg-muted/30 rounded-lg p-2.5 text-center">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Billing Ends</p>
              <p className="font-semibold text-foreground tabular-nums">
                {profile.daysUntilBillingEnd !== null
                  ? `${profile.daysUntilBillingEnd}d`
                  : profile.daysPastDue !== null
                  ? `-${profile.daysPastDue}d`
                  : "-"}
              </p>
            </div>
            <div className="bg-muted/30 rounded-lg p-2.5 text-center">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Trial Ends</p>
              <p className="font-semibold text-foreground tabular-nums">
                {profile.daysUntilTrialEnd !== null ? `${profile.daysUntilTrialEnd}d` : "-"}
              </p>
            </div>
            <div className="bg-muted/30 rounded-lg p-2.5 text-center">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Grace Ends</p>
              <p className="font-semibold text-foreground tabular-nums">
                {profile.daysUntilGraceEnd !== null ? `${profile.daysUntilGraceEnd}d` : "-"}
              </p>
            </div>
            <div className="bg-muted/30 rounded-lg p-2.5 text-center">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Days Past Due</p>
              <p className={cn("font-semibold tabular-nums", profile.daysPastDue !== null ? "text-red-600 dark:text-red-400" : "text-foreground")}>
                {profile.daysPastDue !== null ? profile.daysPastDue : "-"}
              </p>
            </div>
          </div>

          {/* Recommended Action description */}
          {actionCfg && profile.recommendedAction !== "none" && (
            <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/20 rounded-lg px-3 py-2">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{actionCfg.description}</span>
            </div>
          )}

          {/* Warnings */}
          {profile.warnings.length > 0 && (
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 space-y-1" data-testid="renewal-warnings">
              {profile.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-amber-900 dark:text-amber-200">
                  <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5 text-amber-500" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          {/* Safety notice */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1" data-testid="renewal-safety-notice">
            <ShieldCheck className="w-3 h-3 shrink-0" />
            <span>{RENEWAL_EMPTY_STATE.safetyNotice}</span>
          </div>
        </div>
      )}

      {/* No data */}
      {!profile && !isLoading && !isError && (
        <p className="text-xs text-muted-foreground">{RENEWAL_EMPTY_STATE.noData}</p>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// P13-H - ConsoleOverviewTab
// Read-only overview of all tenant intelligence layers.
// No action buttons. No mutations. No billing, payment, enforcement, or email.
// -----------------------------------------------------------------------------

function ConsoleOverviewTab({ tenant }: { tenant: PlatformTenantProfile }) {
  const rs = tenant.riskSignalSummary;

  // Derive per-card display values from existing summary data (no new fetch)
  const lifecycleCfg    = TENANT_STATUS_MAP[tenant.tenantStatus as keyof typeof TENANT_STATUS_MAP];
  const subscriptionCfg = SUBSCRIPTION_STATUS_MAP[tenant.subscriptionStatus as keyof typeof SUBSCRIPTION_STATUS_MAP];
  const planCfg         = tenant.planCode ? PLAN_CODE_CONFIG[tenant.planCode as keyof typeof PLAN_CODE_CONFIG] ?? null : null;
  const healthCfg       = TENANT_HEALTH_STATUS_CONFIG[rs.healthStatus as TenantHealthStatus] ?? null;
  const riskCfg         = CAPACITY_RISK_CONFIG[(tenant.usageSummary.capacityRiskLevel as CapacityRiskLevel) ?? "unknown"] ?? CAPACITY_RISK_CONFIG.unknown;
  const renewalUrgencyCfg = RENEWAL_URGENCY_CONFIG[rs.renewalUrgency as RenewalUrgency] ?? null;

  // Collect key warnings from summary (no additional fetch)
  const activeWarnings: string[] = [];
  if (rs.graceExpired)           activeWarnings.push("Subscription grace period has expired");
  if (rs.subscriptionExpired)    activeWarnings.push("Subscription is expired");
  if (rs.gracePeriodActive)      activeWarnings.push("Subscription is in grace period");
  if (rs.renewalDueNow)          activeWarnings.push("Renewal is due now");
  if (rs.renewalDueSoon)         activeWarnings.push("Renewal is due soon");
  if (rs.trialEndingSoon)        activeWarnings.push("Trial is ending soon");
  if (rs.graceEndingSoon)        activeWarnings.push("Grace period is ending soon");
  if (rs.usageLimitExceeded)     activeWarnings.push("Usage limit has been exceeded");
  if (rs.usageLimitApproaching)  activeWarnings.push("Usage is approaching the limit");
  if (rs.governanceWarnings)     activeWarnings.push("Governance warnings are present");
  if (rs.healthWarningCount > 0) activeWarnings.push(`${rs.healthWarningCount} health warning${rs.healthWarningCount !== 1 ? "s" : ""} detected`);

  // Consolidated recommended action from health summary
  const healthActionCfg = TENANT_HEALTH_ACTION_CONFIG[rs.healthRecommendedAction as RecommendedTenantHealthAction] ?? null;

  return (
    <div
      className="space-y-5"
      data-testid="console-overview-tab"
    >
      {/* Safety banner */}
      <div
        className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 border border-border rounded-lg px-3 py-2"
        data-testid="console-overview-safety-banner"
      >
        <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
        <span>{CONSOLE_EMPTY_STATE.overviewSafetyBanner}</span>
      </div>

      {/* Identity summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-8 gap-y-3 text-sm">
        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Workspace</p>
          <dl className="space-y-0.5">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Name</dt>
              <dd className="font-medium text-foreground text-right truncate max-w-[160px]">{tenant.workspaceName}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Owner</dt>
              <dd className="text-right truncate max-w-[160px]">{tenant.primaryOwnerFullName ?? "-"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Email</dt>
              <dd className="text-right truncate max-w-[160px] text-xs">{tenant.primaryOwnerEmail ?? "-"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Users</dt>
              <dd className="font-medium">{tenant.userCount}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Seat limit</dt>
              <dd>{tenant.usageSummary.seatLimit ?? "-"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Tickets</dt>
              <dd>{tenant.ticketCount}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Departments</dt>
              <dd>{tenant.departmentCount}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Last activity</dt>
              <dd className="text-xs">{formatDate(tenant.lastActivityAt)}</dd>
            </div>
          </dl>
        </div>

        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Subscription &amp; Plan</p>
          <dl className="space-y-0.5">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Plan</dt>
              <dd>
                {planCfg
                  ? <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium", planCfg.badgeClass)}>{planCfg.name}</span>
                  : <span className="text-xs text-muted-foreground italic">{TENANT_REGISTRY_EMPTY_STATE.noPlan}</span>
                }
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Subscription</dt>
              <dd><SubscriptionBadge status={tenant.subscriptionStatus} /></dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Period start</dt>
              <dd className="text-xs">{formatDate(tenant.billingPeriodStart)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Period end</dt>
              <dd className="text-xs">{formatDate(tenant.billingPeriodEnd)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Trial ends</dt>
              <dd className="text-xs">{formatDate(tenant.trialEndsAt)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Grace ends</dt>
              <dd className="text-xs">{formatDate(tenant.gracePeriodEndsAt)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Region</dt>
              <dd className="text-xs">{tenant.region ?? "-"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Data residency</dt>
              <dd className="text-xs">{tenant.dataResidency ?? "-"}</dd>
            </div>
          </dl>
        </div>

        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Module Summary</p>
          <dl className="space-y-0.5">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Enabled modules</dt>
              <dd className="font-medium text-emerald-600 dark:text-emerald-400">{tenant.moduleSummary.enabledModules.length}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Disabled modules</dt>
              <dd className="text-muted-foreground">{tenant.moduleSummary.disabledModules.length}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Custom overrides</dt>
              <dd className={cn("font-medium", tenant.moduleSummary.customEntitlementsCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
                {tenant.moduleSummary.customEntitlementsCount}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Usage warnings</dt>
              <dd className={cn(tenant.usageSummary.usageWarningCount > 0 ? "text-amber-600 dark:text-amber-400 font-medium" : "text-muted-foreground")}>
                {tenant.usageSummary.usageWarningCount}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Exceeded metrics</dt>
              <dd className={cn(tenant.usageSummary.usageExceededCount > 0 ? "text-red-600 dark:text-red-400 font-medium" : "text-muted-foreground")}>
                {tenant.usageSummary.usageExceededCount}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Summary cards grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2" data-testid="console-overview-cards">
        {/* Lifecycle State */}
        <div
          className="bg-card border border-border rounded-lg px-3 py-2.5 flex flex-col gap-1"
          data-testid={OVERVIEW_CARD_CONFIG.lifecycle_state.testId}
        >
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{OVERVIEW_CARD_CONFIG.lifecycle_state.label}</p>
          {lifecycleCfg
            ? <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-semibold self-start", lifecycleCfg.badgeClass)}>{lifecycleCfg.label}</span>
            : <span className="text-xs text-muted-foreground">{tenant.tenantStatus}</span>
          }
        </div>

        {/* Subscription */}
        <div
          className="bg-card border border-border rounded-lg px-3 py-2.5 flex flex-col gap-1"
          data-testid={OVERVIEW_CARD_CONFIG.subscription.testId}
        >
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{OVERVIEW_CARD_CONFIG.subscription.label}</p>
          {subscriptionCfg
            ? <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-semibold self-start", subscriptionCfg.badgeClass)}>{subscriptionCfg.label}</span>
            : <span className="text-xs text-muted-foreground italic">{TENANT_REGISTRY_EMPTY_STATE.noSubscription}</span>
          }
        </div>

        {/* Plan */}
        <div
          className="bg-card border border-border rounded-lg px-3 py-2.5 flex flex-col gap-1"
          data-testid={OVERVIEW_CARD_CONFIG.plan.testId}
        >
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{OVERVIEW_CARD_CONFIG.plan.label}</p>
          {planCfg
            ? <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-semibold self-start", planCfg.badgeClass)}>{planCfg.name}</span>
            : <span className="text-xs text-muted-foreground italic">{TENANT_REGISTRY_EMPTY_STATE.noPlan}</span>
          }
        </div>

        {/* Health */}
        <div
          className="bg-card border border-border rounded-lg px-3 py-2.5 flex flex-col gap-1"
          data-testid={OVERVIEW_CARD_CONFIG.health.testId}
        >
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{OVERVIEW_CARD_CONFIG.health.label}</p>
          {healthCfg
            ? <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-semibold self-start border", healthCfg.badgeClass)}>{healthCfg.label}</span>
            : <span className="text-xs text-muted-foreground">-</span>
          }
          <span className="text-[10px] text-muted-foreground">
            Risk: {TENANT_HEALTH_RISK_CONFIG[rs.healthRiskLevel as TenantHealthRiskLevel]?.label ?? rs.healthRiskLevel}
          </span>
        </div>

        {/* Usage Capacity */}
        <div
          className="bg-card border border-border rounded-lg px-3 py-2.5 flex flex-col gap-1"
          data-testid={OVERVIEW_CARD_CONFIG.usage_capacity.testId}
        >
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{OVERVIEW_CARD_CONFIG.usage_capacity.label}</p>
          <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-semibold self-start", riskCfg.badgeClass)}>
            {riskCfg.label}
          </span>
          {tenant.usageSummary.usageWarningCount > 0 && (
            <span className="text-[10px] text-amber-600 dark:text-amber-400">{tenant.usageSummary.usageWarningCount} warning{tenant.usageSummary.usageWarningCount !== 1 ? "s" : ""}</span>
          )}
        </div>

        {/* Renewal Urgency */}
        <div
          className="bg-card border border-border rounded-lg px-3 py-2.5 flex flex-col gap-1"
          data-testid={OVERVIEW_CARD_CONFIG.renewal.testId}
        >
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{OVERVIEW_CARD_CONFIG.renewal.label}</p>
          {renewalUrgencyCfg
            ? <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-semibold self-start", renewalUrgencyCfg.badgeClass)}>{renewalUrgencyCfg.label}</span>
            : <span className="text-xs text-muted-foreground">None</span>
          }
        </div>
      </div>

      {/* Recommended action (from health intelligence) */}
      {healthActionCfg && rs.healthRecommendedAction !== "none" && (
        <div className="flex items-start gap-2 text-xs bg-muted/20 border border-border rounded-lg px-3 py-2.5">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-muted-foreground" />
          <div>
            <span className="font-medium text-foreground">Recommended: </span>
            <span className="text-muted-foreground">{healthActionCfg.description}</span>
          </div>
        </div>
      )}

      {/* Active risk/warning list */}
      {activeWarnings.length > 0 ? (
        <div
          className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2.5 space-y-1"
          data-testid="console-overview-warnings"
        >
          <p className="text-xs font-semibold text-amber-900 dark:text-amber-200 mb-1">Active Risk Signals</p>
          {activeWarnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5 text-amber-500" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs text-muted-foreground px-3 py-2 bg-muted/20 rounded-lg border border-border">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          <span>{CONSOLE_EMPTY_STATE.noWarnings}</span>
        </div>
      )}

      {/* Overall risk badge */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-muted-foreground font-medium">Overall Risk:</span>
        <RiskBadge level={rs.riskLevel} />
        <span className="text-xs text-muted-foreground"> - </span>
        <span className="text-xs text-muted-foreground font-medium">Tenant ID:</span>
        <span className="text-xs font-mono text-muted-foreground">{tenant.tenantId}</span>
      </div>
    </div>
  );
}

// P13-H - TenantAdminConsole (replaces flat TenantDetailPanel)
// Tabbed administration console consolidating all P13 panels.
// -----------------------------------------------------------------------------

function TenantAdminConsole({
  tenant,
  initialTab,
}: {
  tenant: PlatformTenantProfile;
  initialTab?: ConsoleTab;
}) {
  const { user: authUser } = useAppAuth();

  // Filter tabs by platform permission - synchronous, uses auth context
  const visibleTabs = dedupeConsoleTabs(
    CONSOLE_TABS.filter((tab) => canViewTenantConsoleTab(authUser ?? {}, tab)),
  );

  // Write-action capabilities
  const canWriteLifecycle          = canPerformPlatformAction(authUser ?? {}, "tenant.lifecycle.update");
  const canWriteSubscription       = canPerformPlatformAction(authUser ?? {}, "tenant.subscription.update");
  const canReadTenantRegistrySubscription = hasPlatformPermissionClient(
    authUser ?? {},
    "subscriptions.read",
  );
  const canReadWorkspaceSubscription = hasPlatformPermissionClient(authUser ?? {}, "platform.subscriptions.read");
  const canWriteWorkspaceSubscription = canPerformPlatformAction(authUser ?? {}, "tenant.workspace_subscription.update");
  const canChangeWorkspaceSubscriptionStatus = canPerformPlatformAction(
    authUser ?? {},
    "tenant.workspace_subscription.status.change",
  );
  const canReadProductModules = hasPlatformPermissionClient(authUser ?? {}, "tenants.read");
  const canUpdateProductModules = hasPlatformPermissionClient(authUser ?? {}, "platform.modules.govern");
  const canReadWorkspaceAccess = hasPlatformPermissionClient(
    authUser ?? {},
    "platform.workspaceAccess.read",
  );
  const canUpdateWorkspaceAccess = canPerformPlatformAction(
    authUser ?? {},
    "tenant.workspace_access.update",
  );
  const canEvaluateWorkspaceAccess = hasPlatformPermissionClient(
    authUser ?? {},
    "platform.workspaceAccess.evaluate",
  );
  const canWriteEntitlements       = canPerformPlatformAction(authUser ?? {}, "tenant.entitlement.override.update");
  const canWriteCommercialAccount  = canPerformPlatformAction(authUser ?? {}, "commercial.accounts.update");
  const canWriteCommercialContacts = canPerformPlatformAction(authUser ?? {}, "commercial.contacts.update");
  const canReadCommercialContracts  = hasPlatformPermissionClient(authUser ?? {}, "commercial.contracts.read");
  const canWriteCommercialContracts = canPerformPlatformAction(authUser ?? {}, "commercial.contracts.update");
  const canReadCommercialInvoices     = hasPlatformPermissionClient(authUser ?? {}, "commercial.invoices.read");
  const canWriteCommercialInvoices  = canPerformPlatformAction(authUser ?? {}, "commercial.invoices.update");
  const canReadInvoiceDocuments       = hasPlatformPermissionClient(authUser ?? {}, "commercial.invoiceDocuments.read");
  const canUploadInvoiceDocuments     = canPerformPlatformAction(authUser ?? {}, "commercial.invoiceDocuments.upload");
  const canReadCommercialPayments     = hasPlatformPermissionClient(authUser ?? {}, "commercial.payments.read");
  const canRecordCommercialPayments   = canPerformPlatformAction(authUser ?? {}, "commercial.payments.record");
  const canVerifyCommercialPayments   = canPerformPlatformAction(authUser ?? {}, "commercial.payments.verify");
  const canReadCommercialContacts     = hasPlatformPermissionClient(authUser ?? {}, "commercial.contacts.read");
  const canReadCommercialRisk         = hasPlatformPermissionClient(authUser ?? {}, "commercial.risk.read");
  const canReadCommercialActivity     = hasAnyPlatformPermissionClient(authUser ?? {}, [
    "platform.activity.read",
    "audit.read",
  ]);

  const [activeTab, setActiveTab] = useState<ConsoleTab>(() => {
    const normalized = initialTab ? normalizeConsoleTab(initialTab) : null;
    if (normalized && visibleTabs.includes(normalized)) return normalized;
    return visibleTabs[0] ?? "overview";
  });

  useEffect(() => {
    if (initialTab) {
      const normalized = normalizeConsoleTab(initialTab);
      if (visibleTabs.includes(normalized)) {
        setActiveTab(normalized);
      }
    }
  }, [initialTab, visibleTabs]);

  // Keep activeTab valid when visibleTabs changes (e.g. on role load)
  const effectiveTabRaw = visibleTabs.includes(activeTab)
    ? activeTab
    : (visibleTabs[0] ?? "overview");
  const effectiveTab = normalizeConsoleTab(effectiveTabRaw);

  return (
    <div
      data-testid={`tenant-detail-${tenant.tenantId}`}
      className="bg-muted/20 border-t border-border"
    >
      {/* No visible tabs -> access denied */}
      {visibleTabs.length === 0 && (
        <div className="px-6 py-8" data-testid="console-no-tabs-denied">
          <PlatformAccessDenied
            requiredPermission="tenants.read"
            message="You do not have permission to view this tenant's administration console."
          />
        </div>
      )}

      {visibleTabs.length > 0 && (
        <>
          <TenantConsoleTabBar
            visibleTabs={visibleTabs}
            activeTab={effectiveTab}
            onTabChange={setActiveTab}
          />

          <div
            className="px-4 sm:px-6 py-4 sm:py-5 min-w-0"
            role="tabpanel"
            id={`console-tabpanel-${effectiveTab}`}
            aria-labelledby={`console-tab-${effectiveTab}`}
          >
            {effectiveTab === "overview" && (
              <ConsoleOverviewTab tenant={tenant} />
            )}
            {effectiveTab === "lifecycle" && (
              <div data-testid="console-tab-content-lifecycle">
                <LifecycleControlPanel tenant={tenant} canWrite={canWriteLifecycle} />
              </div>
            )}
            {effectiveTab === "subscription" && (
              <div data-testid="console-tab-content-subscription">
                <TenantCommercialConsole
                  tenantId={String(tenant.tenantId)}
                  tenantDisplayName={tenant.tenantDisplayName}
                  canReadSubscription={canReadWorkspaceSubscription}
                  canUpdateSubscription={canWriteWorkspaceSubscription}
                  canChangeSubscriptionStatus={canChangeWorkspaceSubscriptionStatus}
                  canReadProductModules={canReadProductModules}
                  canUpdateProductModules={canUpdateProductModules}
                  canReadWorkspaceAccess={canReadWorkspaceAccess}
                  canUpdateWorkspaceAccess={canUpdateWorkspaceAccess}
                  canEvaluateWorkspaceAccess={canEvaluateWorkspaceAccess}
                  onOpenCommercialTab={() => setActiveTab("commercial")}
                />
              </div>
            )}
            {effectiveTab === "entitlements" && (
              <div data-testid="console-tab-content-entitlements">
                <p className="text-sm text-muted-foreground mb-3">
                  Product access is managed under the Subscription tab.
                </p>
                <TenantCommercialConsole
                  tenantId={String(tenant.tenantId)}
                  tenantDisplayName={tenant.tenantDisplayName}
                  canReadSubscription={false}
                  canUpdateSubscription={false}
                  canChangeSubscriptionStatus={false}
                  canReadProductModules={canReadProductModules}
                  canUpdateProductModules={canUpdateProductModules}
                  canReadWorkspaceAccess={false}
                  canUpdateWorkspaceAccess={false}
                  canEvaluateWorkspaceAccess={false}
                />
              </div>
            )}
            {effectiveTab === "usage" && (
              <div data-testid="console-tab-content-usage">
                <UsagePanel tenant={tenant} />
              </div>
            )}
            {effectiveTab === "renewal" && (
              <div data-testid="console-tab-content-renewal">
                <RenewalIntelligencePanel tenant={tenant} />
              </div>
            )}
            {effectiveTab === "health" && (
              <div data-testid="console-tab-content-health">
                <TenantHealthPanel tenant={tenant} />
              </div>
            )}
            {effectiveTab === "evaluation" && (
              <div data-testid="console-tab-content-evaluation">
                <TenantEvaluationPanel tenant={tenant} />
              </div>
            )}
            {effectiveTab === "commercial" && (
              <div data-testid="console-tab-content-commercial">
                <CommercialConsole
                  tenant={tenant}
                  canReadAccount={hasPlatformPermissionClient(authUser ?? {}, "commercial.accounts.read")}
                  canWriteAccount={canWriteCommercialAccount}
                  canReadContacts={canReadCommercialContacts}
                  canWriteContacts={canWriteCommercialContacts}
                  canReadContracts={canReadCommercialContracts}
                  canWriteContracts={canWriteCommercialContracts}
                  canReadInvoices={canReadCommercialInvoices}
                  canWriteInvoices={canWriteCommercialInvoices}
                  canReadDocuments={canReadInvoiceDocuments}
                  canUploadDocuments={canUploadInvoiceDocuments}
                  canReadPayments={canReadCommercialPayments}
                  canRecordPayments={canRecordCommercialPayments}
                  canVerifyPayments={canVerifyCommercialPayments}
                  canReadRisk={canReadCommercialRisk}
                  canReadActivity={canReadCommercialActivity}
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Keep TenantDetailPanel as an alias for backward compatibility
function TenantDetailPanel({
  tenant,
  initialTab,
}: {
  tenant: PlatformTenantProfile;
  initialTab?: ConsoleTab;
}) {
  return <TenantAdminConsole tenant={tenant} initialTab={initialTab} />;
}

// -----------------------------------------------------------------------------
// Table Row
// -----------------------------------------------------------------------------

function TenantTableRow({
  tenant,
  deepLinkTenantId,
  deepLinkTab,
}: {
  tenant: PlatformTenantProfile;
  deepLinkTenantId?: string | null;
  deepLinkTab?: ConsoleTab | null;
}) {
  const shouldExpand = deepLinkTenantId === String(tenant.tenantId);
  const [expanded, setExpanded] = useState(shouldExpand);

  useEffect(() => {
    if (shouldExpand) setExpanded(true);
  }, [shouldExpand]);

  return (
    <>
      <tr
        className={cn(
          "border-b border-border text-sm hover:bg-muted/30 transition-colors cursor-pointer",
          expanded && "bg-muted/20",
        )}
        onClick={() => setExpanded(e => !e)}
        data-testid={`tenant-row-${tenant.tenantId}`}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            {expanded
              ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
            <div>
              <p className="font-medium text-foreground">{tenant.workspaceName}</p>
              <p className="text-xs text-muted-foreground">ID: {tenant.tenantId}</p>
            </div>
          </div>
        </td>
        <td className="px-4 py-3">
          {tenant.primaryOwnerEmail
            ? (
              <div>
                <p className="text-foreground">{tenant.primaryOwnerFullName ?? "-"}</p>
                <p className="text-xs text-muted-foreground truncate max-w-[160px]">{tenant.primaryOwnerEmail}</p>
              </div>
            )
            : <span className="text-xs text-muted-foreground">{TENANT_REGISTRY_EMPTY_STATE.noOwner}</span>
          }
        </td>
        <td className="px-4 py-3">
          <TenantStatusBadge status={tenant.tenantStatus} />
        </td>
        <td className="px-4 py-3">
          <SubscriptionBadge status={tenant.subscriptionStatus} />
        </td>
        <td className="px-4 py-3 text-muted-foreground">
          {tenant.planCode ?? <span className="text-xs italic">{TENANT_REGISTRY_EMPTY_STATE.noPlan}</span>}
        </td>
        <td className="px-4 py-3">
          <RiskBadge level={tenant.riskSignalSummary.riskLevel} />
        </td>
        <td className="px-4 py-3">
          {(() => {
            const hs  = tenant.riskSignalSummary.healthStatus;
            const cfg = TENANT_HEALTH_STATUS_CONFIG[hs as TenantHealthStatus];
            if (!cfg) return <span className="text-xs text-muted-foreground">-</span>;
            return (
              <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border", cfg.badgeClass)}>
                {cfg.label}
              </span>
            );
          })()}
        </td>
        <td className="px-4 py-3 text-right tabular-nums">
          {tenant.userCount}
        </td>
        <td className="px-4 py-3 text-muted-foreground text-xs">
          {formatDate(tenant.lastActivityAt)}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={9} className="p-0">
            <TenantDetailPanel
              tenant={tenant}
              initialTab={shouldExpand ? deepLinkTab ?? undefined : undefined}
            />
          </td>
        </tr>
      )}
    </>
  );
}

// -----------------------------------------------------------------------------
// Stats Bar
// -----------------------------------------------------------------------------

function RegistryStatsBar({ tenants }: { tenants: PlatformTenantProfile[] }) {
  const total     = tenants.length;
  const active    = tenants.filter(t => t.tenantStatus === "active").length;
  const suspended = tenants.filter(t => t.tenantStatus === "suspended").length;
  const archived  = tenants.filter(t => t.tenantStatus === "archived").length;
  const highRisk  = tenants.filter(t =>
    t.riskSignalSummary.riskLevel === "high" || t.riskSignalSummary.riskLevel === "critical"
  ).length;

  return (
    <div
      data-testid="registry-stats-bar"
      className="grid grid-cols-2 md:grid-cols-5 gap-3"
    >
      {[
        { label: "Total",     value: total,     icon: Building2,    color: "text-foreground" },
        { label: "Active",    value: active,    icon: Activity,     color: "text-emerald-600 dark:text-emerald-400" },
        { label: "Suspended", value: suspended, icon: AlertTriangle, color: suspended > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground" },
        { label: "Archived",  value: archived,  icon: Package,      color: "text-muted-foreground" },
        { label: "High Risk", value: highRisk,  icon: ShieldCheck,  color: highRisk > 0 ? "text-orange-600 dark:text-orange-400" : "text-muted-foreground" },
      ].map(({ label, value, icon: Icon, color }) => (
        <div key={label} className="bg-card border border-border rounded-lg px-4 py-3 flex items-center gap-3">
          <Icon className={cn("w-5 h-5 shrink-0", color)} />
          <div>
            <p className={cn("text-xl font-bold tabular-nums", color)}>{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Filter Bar
// -----------------------------------------------------------------------------

interface FilterState {
  search:             string;
  status:             string;
  subscriptionStatus: string;
  riskLevel:          string;
}

function RegistryFilterBar({
  filters,
  onChange,
}: {
  filters:  FilterState;
  onChange: (f: FilterState) => void;
}) {
  return (
    <div
      data-testid="registry-filter-bar"
      className="flex flex-wrap gap-3 items-center rounded-lg border border-border bg-card p-3"
    >
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <Input
          data-testid="registry-search-input"
          placeholder="Search by name or owner..."
          value={filters.search}
          onChange={e => onChange({ ...filters, search: e.target.value })}
          className="pl-9 h-9 text-sm"
        />
      </div>

      <Select
        value={filters.status || "_all"}
        onValueChange={v => onChange({ ...filters, status: v === "_all" ? "" : v })}
      >
        <SelectTrigger
          data-testid="registry-status-filter"
          className="h-9 w-[160px] text-sm"
        >
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          {TENANT_STATUS_FILTER_OPTIONS.map(opt => (
            <SelectItem key={opt.value || "_all"} value={opt.value || "_all"}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.riskLevel || "_all"}
        onValueChange={v => onChange({ ...filters, riskLevel: v === "_all" ? "" : v })}
      >
        <SelectTrigger
          data-testid="registry-risk-filter"
          className="h-9 w-[150px] text-sm"
        >
          <SelectValue placeholder="Risk level" />
        </SelectTrigger>
        <SelectContent>
          {RISK_LEVEL_FILTER_OPTIONS.map(opt => (
            <SelectItem key={opt.value || "_all"} value={opt.value || "_all"}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.subscriptionStatus || "_all"}
        onValueChange={v => onChange({ ...filters, subscriptionStatus: v === "_all" ? "" : v })}
      >
        <SelectTrigger
          data-testid="registry-subscription-filter"
          className="h-9 w-[170px] text-sm"
        >
          <SelectValue placeholder="Subscription" />
        </SelectTrigger>
        <SelectContent>
          {SUBSCRIPTION_STATUS_FILTER_OPTIONS.map(opt => (
            <SelectItem key={opt.value || "_all"} value={opt.value || "_all"}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Main Page
// -----------------------------------------------------------------------------

function parseRegistryDeepLink(): { tenantId: string | null; tab: ConsoleTab | null } {
  if (typeof window === "undefined") return { tenantId: null, tab: null };
  const params = new URLSearchParams(window.location.search);
  const tenantId = params.get("tenantId") ?? params.get("expand");
  const tab = parseConsoleTabParam(params.get("tab"));
  return { tenantId, tab };
}

export default function SuperAdminTenants() {
  const deepLink = useMemo(() => parseRegistryDeepLink(), []);

  const [filters, setFilters] = useState<FilterState>({
    search:             "",
    status:             "",
    subscriptionStatus: "",
    riskLevel:          "",
  });

  const apiFilters = useMemo(() => ({
    search:             filters.search             || undefined,
    status:             filters.status             || undefined,
    subscriptionStatus: filters.subscriptionStatus || undefined,
    riskLevel:          filters.riskLevel          || undefined,
  }), [filters]);

  const { data, isLoading, isError, error } = useTenantRegistry(apiFilters);
  const tenants = data?.tenants ?? [];

  return (
    <div className="space-y-6" data-testid="platform-tenants-page">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Building2 className="w-6 h-6 text-primary" />
            Platform Tenant Registry
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Read-only inventory of all workspaces registered on this platform.
            Subscription and plan data is reserved for future configuration.
          </p>
        </div>
        <Badge
          variant="outline"
          className="shrink-0 text-xs flex items-center gap-1.5 border-amber-300 text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20"
          data-testid="registry-read-only-badge"
        >
          <ShieldCheck className="w-3 h-3" />
          Read-only  -  Super-admin only
        </Badge>
      </div>

      {/* Read-only notice */}
      <div
        data-testid="registry-read-only-notice"
        className="flex items-start gap-3 p-3 rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 text-sm text-amber-800 dark:text-amber-300"
      >
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <p>
          This registry is <strong>observation-only</strong>. No tenant suspension, deletion,
          subscription changes, or billing actions are available here.
          Subscription and plan fields will show as "not configured" until platform billing is set up.
        </p>
      </div>

      {/* Stats bar - only when data is loaded */}
      {!isLoading && !isError && data && (
        <RegistryStatsBar tenants={data.tenants} />
      )}

      {/* Filter bar */}
      <RegistryFilterBar filters={filters} onChange={setFilters} />

      {/* Loading state */}
      {isLoading && (
        <div
          data-testid="registry-loading"
          className="py-16 text-center text-muted-foreground"
        >
          <Building2 className="w-8 h-8 mx-auto mb-3 animate-pulse" />
          <p>{TENANT_REGISTRY_EMPTY_STATE.loadingRegistry}</p>
        </div>
      )}

      {/* Error state */}
      {isError && !isLoading && (
        <div
          data-testid="registry-error"
          className="py-12 text-center"
        >
          <AlertTriangle className="w-8 h-8 mx-auto mb-3 text-destructive" />
          <p className="text-sm text-destructive font-medium">Failed to load tenant registry</p>
          <p className="text-xs text-muted-foreground mt-1">
            {error instanceof Error ? error.message : "Unknown error"}
          </p>
        </div>
      )}

      {/* Registry table */}
      {!isLoading && !isError && (
        <div className="rounded-lg border border-border overflow-hidden bg-card shadow-sm">
          {tenants.length === 0 ? (
            <div
              data-testid="registry-empty"
              className="py-16 text-center text-muted-foreground"
            >
              <Users className="w-8 h-8 mx-auto mb-3 opacity-40" />
              <p className="text-sm">
                {apiFilters.search || apiFilters.status || apiFilters.riskLevel || apiFilters.subscriptionStatus
                  ? TENANT_REGISTRY_EMPTY_STATE.noResults
                  : TENANT_REGISTRY_EMPTY_STATE.noTenants}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table
                data-testid="tenant-registry-table"
                className="w-full text-sm"
              >
                <thead>
                  <tr className="border-b border-border bg-muted/50 dark:bg-muted/30">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Workspace
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Owner
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Status
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Subscription
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Plan
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Risk
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Health
                    </th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Users
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Last Activity
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.map(tenant => (
                    <TenantTableRow
                      key={tenant.tenantId}
                      tenant={tenant}
                      deepLinkTenantId={deepLink.tenantId}
                      deepLinkTab={deepLink.tab}
                    />
                  ))}
                </tbody>
              </table>

              <div className="px-4 py-2.5 border-t border-border bg-muted/20 text-xs text-muted-foreground flex items-center justify-between">
                <span>
                  Showing {tenants.length} of {data?.total ?? tenants.length} tenant{tenants.length !== 1 ? "s" : ""}
                </span>
                <span className="flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" />
                  Read-only  -  No mutations permitted
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
