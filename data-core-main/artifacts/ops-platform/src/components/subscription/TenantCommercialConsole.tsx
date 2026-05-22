/**
 * Enterprise HCM Commercial Console — canonical subscription + product access + workspace access.
 */

import { SubscriptionStatePanel } from "@/components/subscription/SubscriptionStatePanel";
import { ProductModulesPanel } from "@/components/subscription/ProductModulesPanel";
import { WorkspaceAccessControlPanel } from "@/components/subscription/WorkspaceAccessControlPanel";
import { useTenantSubscription } from "@/hooks/use-tenant-subscription";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export interface TenantCommercialConsoleProps {
  tenantId: string;
  tenantDisplayName?: string;
  canReadSubscription: boolean;
  canUpdateSubscription: boolean;
  canChangeSubscriptionStatus: boolean;
  canReadProductModules: boolean;
  canUpdateProductModules: boolean;
  canReadWorkspaceAccess: boolean;
  canUpdateWorkspaceAccess: boolean;
  canEvaluateWorkspaceAccess: boolean;
  onOpenCommercialTab?: () => void;
}

export function TenantCommercialConsole({
  tenantId,
  tenantDisplayName,
  canReadSubscription,
  canUpdateSubscription,
  canChangeSubscriptionStatus,
  canReadProductModules,
  canUpdateProductModules,
  canReadWorkspaceAccess,
  canUpdateWorkspaceAccess,
  canEvaluateWorkspaceAccess,
  onOpenCommercialTab,
}: TenantCommercialConsoleProps) {
  const { data: subscription, isLoading } = useTenantSubscription(
    canReadSubscription ? tenantId : undefined,
  );

  const hasSubscription = subscription != null;

  if (!canReadSubscription && !canReadProductModules && !canReadWorkspaceAccess) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="commercial-console-denied">
        You do not have permission to view the commercial console.
      </p>
    );
  }

  return (
    <div className="space-y-6" data-testid="tenant-commercial-console">
      <header className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">Commercial &amp; subscription</h3>
        {tenantDisplayName ? (
          <p className="text-sm text-muted-foreground">{tenantDisplayName}</p>
        ) : null}
      </header>

      {canReadSubscription && (
        <section className="space-y-3" data-testid="plan-subscription-section">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">Plan &amp; subscription</h4>
            {onOpenCommercialTab ? (
              <Button type="button" variant="outline" size="sm" onClick={onOpenCommercialTab}>
                Commercial agreements
              </Button>
            ) : null}
          </div>
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading subscription...
            </div>
          ) : !hasSubscription ? (
            <div
              className="rounded-lg border border-dashed border-border p-6 text-center space-y-3"
              data-testid="subscription-empty-state"
            >
              <p className="text-sm font-medium">No subscription configured</p>
              <p className="text-xs text-muted-foreground">
                Set up a plan and term before configuring modules or access controls.
              </p>
              {canUpdateSubscription && (
                <SubscriptionStatePanel
                  tenantId={tenantId}
                  canRead={canReadSubscription}
                  canUpdate={canUpdateSubscription}
                  canChangeStatus={canChangeSubscriptionStatus}
                />
              )}
            </div>
          ) : (
            <SubscriptionStatePanel
              tenantId={tenantId}
              canRead={canReadSubscription}
              canUpdate={canUpdateSubscription}
              canChangeStatus={canChangeSubscriptionStatus}
            />
          )}
        </section>
      )}

      {hasSubscription && canReadProductModules && (
        <section className="space-y-3" data-testid="product-access-section">
          <h4 className="text-sm font-semibold">Product access</h4>
          <ProductModulesPanel
            tenantId={tenantId}
            canRead={canReadProductModules}
            canUpdate={canUpdateProductModules}
          />
        </section>
      )}

      {hasSubscription && canReadWorkspaceAccess && (
        <section className="space-y-3" data-testid="workspace-access-section">
          <h4 className="text-sm font-semibold">Workspace access</h4>
          <p className="text-xs text-muted-foreground">
            Controls whether this workspace accepts operational writes. This is the only live enforcement control.
          </p>
          <WorkspaceAccessControlPanel
            tenantId={tenantId}
            canRead={canReadWorkspaceAccess}
            canUpdate={canUpdateWorkspaceAccess}
            canEvaluate={canEvaluateWorkspaceAccess}
          />
        </section>
      )}
    </div>
  );
}
