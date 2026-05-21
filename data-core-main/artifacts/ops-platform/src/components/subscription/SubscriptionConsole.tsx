/**
 * @phase P16-F - Unified Subscription Console (integration only)
 */

import { Info } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { SubscriptionConsoleSummaryCards } from "@/components/subscription/SubscriptionConsoleSummaryCards";
import { SubscriptionConsoleOverviewSection } from "@/components/subscription/SubscriptionConsoleOverviewSection";
import { SubscriptionStatePanel } from "@/components/subscription/SubscriptionStatePanel";
import { EntitlementsFeaturesPanel } from "@/components/subscription/EntitlementsFeaturesPanel";
import { LimitsQuotasPanel } from "@/components/subscription/LimitsQuotasPanel";
import { GraceSuspensionPolicyPanel } from "@/components/subscription/GraceSuspensionPolicyPanel";
import { WorkspaceAccessControlPanel } from "@/components/subscription/WorkspaceAccessControlPanel";
import { SUBSCRIPTION_CONSOLE_SAFETY_CONTRACT } from "@/lib/subscription-console-config";

export interface SubscriptionConsoleProps {
  tenantId: string;
  registrySubscriptionSlot?: React.ReactNode;
  canReadSubscription: boolean;
  canUpdateSubscription: boolean;
  canChangeSubscriptionStatus: boolean;
  canReadEntitlements: boolean;
  canUpdateEntitlements: boolean;
  canReadQuotas: boolean;
  canUpdateQuotas: boolean;
  canReadSubscriptionPolicies: boolean;
  canUpdateSubscriptionPolicies: boolean;
  canEvaluateSubscriptionPolicies: boolean;
  canApplyRecommendedSubscriptionStatus: boolean;
  canReadWorkspaceAccess: boolean;
  canUpdateWorkspaceAccess: boolean;
  canEvaluateWorkspaceAccess: boolean;
  /** @deprecated P16-F alias - use subscription-console test id */
  legacyConsoleTestId?: string;
}

export function SubscriptionConsole({
  tenantId,
  registrySubscriptionSlot,
  canReadSubscription,
  canUpdateSubscription,
  canChangeSubscriptionStatus,
  canReadEntitlements,
  canUpdateEntitlements,
  canReadQuotas,
  canUpdateQuotas,
  canReadSubscriptionPolicies,
  canUpdateSubscriptionPolicies,
  canEvaluateSubscriptionPolicies,
  canApplyRecommendedSubscriptionStatus,
  canReadWorkspaceAccess,
  canUpdateWorkspaceAccess,
  canEvaluateWorkspaceAccess,
  legacyConsoleTestId = "subscription-console",
}: SubscriptionConsoleProps) {
  void SUBSCRIPTION_CONSOLE_SAFETY_CONTRACT;

  const hasAnySection =
    canReadSubscription ||
    canReadEntitlements ||
    canReadQuotas ||
    canReadSubscriptionPolicies ||
    canReadWorkspaceAccess ||
    !!registrySubscriptionSlot;

  if (!hasAnySection) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="subscription-console-denied">
        No permission to view subscription console sections.
      </p>
    );
  }

  const defaultOpen = ["overview"];
  if (canReadSubscription) defaultOpen.push("state");
  if (canReadEntitlements) defaultOpen.push("entitlements");
  if (canReadQuotas) defaultOpen.push("quotas");
  if (canReadSubscriptionPolicies) defaultOpen.push("policy");
  if (canReadWorkspaceAccess) defaultOpen.push("workspace");

  return (
    <div className="space-y-5" data-testid={legacyConsoleTestId}>
      <div
        className="flex items-start gap-2 p-3 rounded-md bg-muted/40 border border-border text-xs text-muted-foreground"
        data-testid="subscription-console-safety-banner"
      >
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden />
        <span>
          Subscription console - metadata, entitlements, quotas, policy evaluation, and manual
          workspace access. Integration only; no payment gateway, email, or automatic enforcement.
        </span>
      </div>

      <SubscriptionConsoleSummaryCards
        tenantId={tenantId}
        canReadSubscription={canReadSubscription}
        canReadEntitlements={canReadEntitlements}
        canReadQuotas={canReadQuotas}
        canEvaluateSubscriptionPolicies={canEvaluateSubscriptionPolicies}
        canReadWorkspaceAccess={canReadWorkspaceAccess}
        canEvaluateWorkspaceAccess={canEvaluateWorkspaceAccess}
      />

      <Accordion type="multiple" defaultValue={defaultOpen} className="space-y-2">
        <AccordionItem value="overview" className="border border-border rounded-lg px-1">
          <AccordionTrigger className="px-3 py-3 text-sm font-semibold hover:no-underline">
            A) Subscription Overview
          </AccordionTrigger>
          <AccordionContent className="px-3 pb-4 space-y-4">
            <SubscriptionConsoleOverviewSection
              tenantId={tenantId}
              canReadSubscription={canReadSubscription}
              canReadEntitlements={canReadEntitlements}
              canReadQuotas={canReadQuotas}
              canEvaluateSubscriptionPolicies={canEvaluateSubscriptionPolicies}
              canReadWorkspaceAccess={canReadWorkspaceAccess}
              canEvaluateWorkspaceAccess={canEvaluateWorkspaceAccess}
            />
            {registrySubscriptionSlot ? (
              <div data-testid="registry-subscription-metadata-section">{registrySubscriptionSlot}</div>
            ) : null}
          </AccordionContent>
        </AccordionItem>

        {canReadSubscription && (
          <AccordionItem value="state" className="border border-border rounded-lg px-1">
            <AccordionTrigger className="px-3 py-3 text-sm font-semibold hover:no-underline">
              B) Subscription State
            </AccordionTrigger>
            <AccordionContent className="px-3 pb-4" data-testid="subscription-state-section">
              <SubscriptionStatePanel
                tenantId={tenantId}
                canRead={canReadSubscription}
                canUpdate={canUpdateSubscription}
                canChangeStatus={canChangeSubscriptionStatus}
              />
            </AccordionContent>
          </AccordionItem>
        )}

        {canReadEntitlements && (
          <AccordionItem value="entitlements" className="border border-border rounded-lg px-1">
            <AccordionTrigger className="px-3 py-3 text-sm font-semibold hover:no-underline">
              C) Entitlements &amp; Features
            </AccordionTrigger>
            <AccordionContent className="px-3 pb-4" data-testid="entitlements-features-section">
              <EntitlementsFeaturesPanel
                tenantId={tenantId}
                canRead={canReadEntitlements}
                canUpdate={canUpdateEntitlements}
              />
            </AccordionContent>
          </AccordionItem>
        )}

        {canReadQuotas && (
          <AccordionItem value="quotas" className="border border-border rounded-lg px-1">
            <AccordionTrigger className="px-3 py-3 text-sm font-semibold hover:no-underline">
              D) Limits &amp; Quotas
            </AccordionTrigger>
            <AccordionContent className="px-3 pb-4" data-testid="limits-quotas-section">
              <LimitsQuotasPanel
                tenantId={tenantId}
                canRead={canReadQuotas}
                canUpdate={canUpdateQuotas}
              />
            </AccordionContent>
          </AccordionItem>
        )}

        {canReadSubscriptionPolicies && (
          <AccordionItem value="policy" className="border border-border rounded-lg px-1">
            <AccordionTrigger className="px-3 py-3 text-sm font-semibold hover:no-underline">
              E) Grace &amp; Suspension Policy
            </AccordionTrigger>
            <AccordionContent className="px-3 pb-4" data-testid="grace-suspension-policy-section">
              <GraceSuspensionPolicyPanel
                tenantId={tenantId}
                canRead={canReadSubscriptionPolicies}
                canUpdate={canUpdateSubscriptionPolicies}
                canEvaluate={canEvaluateSubscriptionPolicies}
                canApplyRecommendedStatus={canApplyRecommendedSubscriptionStatus}
              />
            </AccordionContent>
          </AccordionItem>
        )}

        {canReadWorkspaceAccess && (
          <AccordionItem value="workspace" className="border border-border rounded-lg px-1">
            <AccordionTrigger className="px-3 py-3 text-sm font-semibold hover:no-underline">
              F) Workspace Access Control
            </AccordionTrigger>
            <AccordionContent className="px-3 pb-4" data-testid="workspace-access-control-section">
              <WorkspaceAccessControlPanel
                tenantId={tenantId}
                canRead={canReadWorkspaceAccess}
                canUpdate={canUpdateWorkspaceAccess}
                canEvaluate={canEvaluateWorkspaceAccess}
              />
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>
    </div>
  );
}
