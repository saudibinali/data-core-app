/**
 * @phase P15-G - Unified Commercial Console (Tenant Registry > Commercial tab)
 */

import { useState } from "react";
import { Info } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { CommercialOverviewSummary } from "@/components/commercial/CommercialOverviewSummary";
import { CommercialAccountSection } from "@/components/commercial/CommercialAccountSection";
import { CommercialRiskSection } from "@/components/commercial/CommercialRiskSection";
import { CommercialCollectionSection } from "@/components/commercial/CommercialCollectionSection";
import { CommercialActivitySection } from "@/components/commercial/CommercialActivitySection";
import { ContractTermsSection } from "@/components/commercial/ContractTermsSection";
import { InvoicesSection } from "@/components/commercial/InvoicesSection";
import { useCommercialAccount } from "@/hooks/use-commercial";
import type { CommercialInvoice } from "@/hooks/use-commercial-invoices";
import type { PlatformTenantProfile } from "@/lib/tenant-registry-hooks";

export interface CommercialConsoleProps {
  tenant: PlatformTenantProfile;
  canReadAccount: boolean;
  canWriteAccount: boolean;
  canReadContacts: boolean;
  canWriteContacts: boolean;
  canReadContracts: boolean;
  canWriteContracts: boolean;
  canReadInvoices: boolean;
  canWriteInvoices: boolean;
  canReadDocuments: boolean;
  canUploadDocuments: boolean;
  canReadPayments: boolean;
  canRecordPayments: boolean;
  canVerifyPayments: boolean;
  canReadRisk: boolean;
  canReadActivity: boolean;
}

export function CommercialConsole({
  tenant,
  canReadAccount,
  canWriteAccount,
  canReadContacts,
  canWriteContacts,
  canReadContracts,
  canWriteContracts,
  canReadInvoices,
  canWriteInvoices,
  canReadDocuments,
  canUploadDocuments,
  canReadPayments,
  canRecordPayments,
  canVerifyPayments,
  canReadRisk,
  canReadActivity,
}: CommercialConsoleProps) {
  const tenantId = String(tenant.tenantId);
  const { data: account } = useCommercialAccount(canReadAccount ? tenantId : undefined);
  const [collectionInvoice, setCollectionInvoice] = useState<CommercialInvoice | null>(null);

  const defaultSections = ["account", "contracts", "invoices"];
  if (canReadPayments) defaultSections.push("collection");
  if (canReadRisk) defaultSections.push("risk");

  return (
    <div className="space-y-5" data-testid="commercial-console">
      <div className="flex items-start gap-2 p-3 rounded-md bg-muted/40 border border-border text-xs text-muted-foreground">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          Unified commercial console - account, contracts, invoices, collection, and risk.
          Read-only integration; no payment gateway, email, or automated workflows.
        </span>
      </div>

      <CommercialOverviewSummary
        tenantId={tenantId}
        canReadAccount={canReadAccount}
        canReadContracts={canReadContracts}
        canReadInvoices={canReadInvoices}
        canReadRisk={canReadRisk}
      />

      <Accordion
        type="multiple"
        defaultValue={defaultSections}
        className="rounded-lg border border-border bg-card px-2"
        data-testid="commercial-console-sections"
      >
        {(canReadAccount || canReadContacts) && (
          <AccordionItem value="account" data-testid="commercial-console-section-account">
            <AccordionTrigger className="text-sm font-semibold px-2">
              Commercial Account
            </AccordionTrigger>
            <AccordionContent className="px-2 pb-4">
              <CommercialAccountSection
                tenantId={tenantId}
                canReadAccount={canReadAccount}
                canWriteAccount={canWriteAccount}
                canReadContacts={canReadContacts}
                canWriteContacts={canWriteContacts}
              />
            </AccordionContent>
          </AccordionItem>
        )}

        {canReadContracts && (
          <AccordionItem value="contracts" data-testid="commercial-console-section-contracts">
            <AccordionTrigger className="text-sm font-semibold px-2">
              Contracts &amp; Renewals
            </AccordionTrigger>
            <AccordionContent className="px-2 pb-4">
              <ContractTermsSection
                tenantId={tenantId}
                commercialAccountId={account?.id}
                canWrite={canWriteContracts}
              />
            </AccordionContent>
          </AccordionItem>
        )}

        {canReadInvoices && (
          <AccordionItem value="invoices" data-testid="commercial-console-section-invoices">
            <AccordionTrigger className="text-sm font-semibold px-2">
              Invoices &amp; Documents
            </AccordionTrigger>
            <AccordionContent className="px-2 pb-4">
              <InvoicesSection
                tenantId={tenantId}
                commercialAccountId={account?.id}
                canWriteInvoice={canWriteInvoices}
                canReadDocuments={canReadDocuments}
                canUploadDocuments={canUploadDocuments}
                canReadPayments={canReadPayments}
                canRecordPayments={canRecordPayments}
                canVerifyPayments={canVerifyPayments}
                hideInlineCollectionPanel
                onOpenCollection={inv => {
                  setCollectionInvoice(inv);
                }}
              />
            </AccordionContent>
          </AccordionItem>
        )}

        {canReadPayments && (
          <AccordionItem value="collection" data-testid="commercial-console-section-collection">
            <AccordionTrigger className="text-sm font-semibold px-2">
              Collection Tracking
            </AccordionTrigger>
            <AccordionContent className="px-2 pb-4">
              <CommercialCollectionSection
                tenantId={tenantId}
                commercialAccountId={account?.id}
                selectedInvoice={collectionInvoice}
                canRecord={canRecordPayments}
                canVerify={canVerifyPayments}
                onClose={() => setCollectionInvoice(null)}
              />
            </AccordionContent>
          </AccordionItem>
        )}

        {canReadRisk && (
          <AccordionItem value="risk" data-testid="commercial-console-section-risk">
            <AccordionTrigger className="text-sm font-semibold px-2">
              Risk &amp; Readiness
            </AccordionTrigger>
            <AccordionContent className="px-2 pb-4">
              <CommercialRiskSection tenantId={tenantId} />
            </AccordionContent>
          </AccordionItem>
        )}

        <AccordionItem value="activity" data-testid="commercial-console-section-activity">
          <AccordionTrigger className="text-sm font-semibold px-2">
            Commercial Activity
          </AccordionTrigger>
          <AccordionContent className="px-2 pb-4">
            {canReadActivity ? (
              <CommercialActivitySection tenantId={tenantId} />
            ) : (
              <p className="text-xs text-muted-foreground" data-testid="commercial-activity-denied">
                Requires platform.activity.read or audit.read.
              </p>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

