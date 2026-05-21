/**
 * @phase P16-F - Subscription overview (read-only snapshot from existing hooks)
 */

import { Loader2 } from "lucide-react";
import { useTenantSubscription } from "@/hooks/use-tenant-subscription";
import { useTenantSubscriptionPolicyEvaluation } from "@/hooks/use-tenant-subscription-policy";
import { useTenantQuotaUsage } from "@/hooks/use-workspace-quotas";
import { useTenantEntitlements } from "@/hooks/use-workspace-entitlements";
import {
  useTenantWorkspaceAccess,
  useTenantWorkspaceAccessEvaluation,
} from "@/hooks/use-workspace-access";
import {
  WORKSPACE_SUBSCRIPTION_STATUS_CONFIG,
  type WorkspaceSubscriptionStatusCode,
} from "@/lib/subscription-state-config";

interface Props {
  tenantId: string;
  canReadSubscription: boolean;
  canReadEntitlements: boolean;
  canReadQuotas: boolean;
  canEvaluateSubscriptionPolicies: boolean;
  canReadWorkspaceAccess: boolean;
  canEvaluateWorkspaceAccess: boolean;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value ?? "-"}</p>
    </div>
  );
}

export function SubscriptionConsoleOverviewSection({
  tenantId,
  canReadSubscription,
  canReadEntitlements,
  canReadQuotas,
  canEvaluateSubscriptionPolicies,
  canReadWorkspaceAccess,
  canEvaluateWorkspaceAccess,
}: Props) {
  const { data: subscription, isLoading: subLoading, isError: subError } =
    useTenantSubscription(canReadSubscription ? tenantId : undefined);
  const { data: entData, isLoading: entLoading } = useTenantEntitlements(
    canReadEntitlements ? tenantId : undefined,
  );
  const { data: usage = [], isLoading: quotaLoading } = useTenantQuotaUsage(
    canReadQuotas ? tenantId : undefined,
  );
  const { data: policyEval, isLoading: policyLoading } =
    useTenantSubscriptionPolicyEvaluation(
      canEvaluateSubscriptionPolicies ? tenantId : undefined,
    );
  const { data: access, isLoading: accessLoading } = useTenantWorkspaceAccess(
    canReadWorkspaceAccess ? tenantId : undefined,
  );
  const { data: accessEval } = useTenantWorkspaceAccessEvaluation(
    canEvaluateWorkspaceAccess ? tenantId : undefined,
  );

  const statusLabel = subscription?.status
    ? (WORKSPACE_SUBSCRIPTION_STATUS_CONFIG[
        subscription.status as WorkspaceSubscriptionStatusCode
      ]?.label ?? subscription.status)
    : "-";

  const enabledModules =
    entData?.entitlements?.filter((e) => e.isEnabled).map((e) => e.moduleKey).slice(0, 6) ??
    [];
  const quotaSummary = usage.length
    ? `${usage.filter((u) => u.status === "exceeded").length} exceeded, ${usage.filter((u) => u.status === "warning").length} warning`
    : "-";

  const loading =
    (canReadSubscription && subLoading) ||
    (canReadEntitlements && entLoading) ||
    (canReadQuotas && quotaLoading) ||
    (canEvaluateSubscriptionPolicies && policyLoading) ||
    (canReadWorkspaceAccess && accessLoading);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading subscription overview...
      </div>
    );
  }

  if (canReadSubscription && subError) {
    return (
      <p className="text-xs text-destructive" data-testid="subscription-overview-error">
        Could not load workspace subscription overview.
      </p>
    );
  }

  const accessMode =
    access?.enforcementStatus ??
    accessEval?.currentAccess?.enforcementStatus ??
    "default";

  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
      data-testid="subscription-console-overview-section"
    >
      {canReadSubscription && (
        <>
          <Field label="Plan" value={subscription?.planName ?? subscription?.subscriptionName} />
          <Field label="Status" value={statusLabel} />
          <Field label="Start" value={subscription?.startDate?.slice(0, 10)} />
          <Field label="End" value={subscription?.endDate?.slice(0, 10)} />
          <Field label="Renewal" value={subscription?.renewalDate?.slice(0, 10)} />
          <Field label="Grace ends" value={subscription?.gracePeriodEndsAt?.slice(0, 10)} />
        </>
      )}
      {(canReadWorkspaceAccess || canEvaluateWorkspaceAccess) && (
        <Field label="Current access mode" value={accessMode} />
      )}
      {canEvaluateSubscriptionPolicies && (
        <Field
          label="Policy recommendation (advisory)"
          value={
            policyEval?.evaluation?.recommendedAction ??
            policyEval?.evaluation?.recommendedStatus ??
            "No evaluation"
          }
        />
      )}
      {canReadEntitlements && (
        <Field
          label="Entitlement summary"
          value={
            enabledModules.length > 0
              ? `${enabledModules.length} enabled (${enabledModules.join(", ")}${(entData?.entitlements?.filter((e) => e.isEnabled).length ?? 0) > 6 ? ", ..." : ""})`
              : "No enabled modules"
          }
        />
      )}
      {canReadQuotas && <Field label="Quota status" value={quotaSummary} />}
    </div>
  );
}
