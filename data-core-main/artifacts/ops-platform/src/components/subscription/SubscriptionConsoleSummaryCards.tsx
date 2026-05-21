/**
 * @phase P16-F - Subscription console top summary cards (existing APIs only)
 */

import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useTenantSubscription } from "@/hooks/use-tenant-subscription";
import { useTenantEntitlements } from "@/hooks/use-workspace-entitlements";
import { useTenantQuotaUsage } from "@/hooks/use-workspace-quotas";
import { useTenantSubscriptionPolicyEvaluation } from "@/hooks/use-tenant-subscription-policy";
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

function SummaryCard({
  label,
  value,
  loading,
  testId,
  variant,
}: {
  label: string;
  value: React.ReactNode;
  loading?: boolean;
  testId: string;
  variant?: "default" | "warning" | "danger";
}) {
  return (
    <Card data-testid={testId}>
      <CardContent className="pt-3 pb-3">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin mt-1 text-muted-foreground" />
        ) : (
          <div
            className={cn(
              "mt-1 text-sm font-semibold",
              variant === "warning" && "text-amber-600 dark:text-amber-400",
              variant === "danger" && "text-destructive",
            )}
          >
            {value ?? "-"}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const end = new Date(iso);
  if (Number.isNaN(end.getTime())) return null;
  const diff = end.getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function statusLabel(code: string | null | undefined): string {
  if (!code) return "-";
  const cfg =
    WORKSPACE_SUBSCRIPTION_STATUS_CONFIG[code as WorkspaceSubscriptionStatusCode];
  return cfg?.label ?? code;
}

export function SubscriptionConsoleSummaryCards({
  tenantId,
  canReadSubscription,
  canReadEntitlements,
  canReadQuotas,
  canEvaluateSubscriptionPolicies,
  canReadWorkspaceAccess,
  canEvaluateWorkspaceAccess,
}: Props) {
  const { data: subscription, isLoading: subLoading } = useTenantSubscription(
    canReadSubscription ? tenantId : undefined,
  );
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
  const { data: accessEval, isLoading: accessEvalLoading } =
    useTenantWorkspaceAccessEvaluation(
      canEvaluateWorkspaceAccess ? tenantId : undefined,
    );

  const enabledCount =
    entData?.entitlements?.filter((e) => e.isEnabled).length ?? null;
  const quotaWarn = usage.filter((u) => u.status === "warning").length;
  const quotaExceeded = usage.filter((u) => u.status === "exceeded").length;
  const daysEnd = daysUntil(subscription?.endDate);
  const policyRec =
    policyEval?.evaluation?.recommendedAction ??
    policyEval?.evaluation?.recommendedStatus ??
    null;
  const accessMode =
    access?.enforcementStatus ??
    accessEval?.currentAccess?.enforcementStatus ??
    null;

  const showAny =
    canReadSubscription ||
    canReadEntitlements ||
    canReadQuotas ||
    canEvaluateSubscriptionPolicies ||
    canReadWorkspaceAccess;

  if (!showAny) return null;

  return (
    <div
      className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2"
      data-testid="subscription-console-summary-cards"
    >
      {canReadSubscription && (
        <SummaryCard
          testId="subscription-summary-status"
          label="Subscription Status"
          loading={subLoading}
          value={
            subscription ? (
              <Badge variant="outline" className="text-xs font-semibold">
                {statusLabel(subscription.status)}
              </Badge>
            ) : (
              "No record"
            )
          }
        />
      )}
      {(canReadWorkspaceAccess || canEvaluateWorkspaceAccess) && (
        <SummaryCard
          testId="subscription-summary-access-mode"
          label="Access Mode"
          loading={accessLoading || accessEvalLoading}
          value={accessMode ?? "default"}
        />
      )}
      {canReadSubscription && (
        <SummaryCard
          testId="subscription-summary-renewal"
          label="Renewal Date"
          loading={subLoading}
          value={subscription?.renewalDate?.slice(0, 10) ?? "-"}
        />
      )}
      {canReadSubscription && (
        <SummaryCard
          testId="subscription-summary-days-until-end"
          label="Days Until End"
          loading={subLoading}
          variant={
            daysEnd !== null && daysEnd <= 0
              ? "danger"
              : daysEnd !== null && daysEnd <= 14
                ? "warning"
                : "default"
          }
          value={
            daysEnd === null
              ? subscription?.endDate
                ? "-"
                : "N/A"
              : String(daysEnd)
          }
        />
      )}
      {canEvaluateSubscriptionPolicies && (
        <SummaryCard
          testId="subscription-summary-policy-recommendation"
          label="Grace / Past Due / Suspension"
          loading={policyLoading}
          value={policyRec ?? "Advisory only"}
          variant={
            policyRec &&
            /suspend|past.?due|terminate/i.test(String(policyRec))
              ? "warning"
              : "default"
          }
        />
      )}
      {canReadEntitlements && (
        <SummaryCard
          testId="subscription-summary-entitlements"
          label="Entitlements Enabled"
          loading={entLoading}
          value={enabledCount !== null ? String(enabledCount) : "-"}
        />
      )}
      {canReadQuotas && (
        <SummaryCard
          testId="subscription-summary-quotas"
          label="Quotas Warning / Exceeded"
          loading={quotaLoading}
          variant={quotaExceeded > 0 ? "danger" : quotaWarn > 0 ? "warning" : "default"}
          value={`${quotaWarn} / ${quotaExceeded}`}
        />
      )}
      {canReadWorkspaceAccess && (
        <SummaryCard
          testId="subscription-summary-workspace-mode"
          label="Workspace Mode"
          loading={accessLoading}
          value={
            access?.allowCreate === false && access?.allowUpdate === false
              ? "Read-only"
              : accessMode ?? "Full"
          }
        />
      )}
    </div>
  );
}
