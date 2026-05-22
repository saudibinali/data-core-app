/**
 * Enterprise HCM operational commercial console — contracts, invoice PDFs, reminders.
 */

import { Info } from "lucide-react";
import { CommercialAccountSection } from "@/components/commercial/CommercialAccountSection";
import { OperationalContractsPanel } from "@/components/commercial/OperationalContractsPanel";
import { OperationalInvoicesPanel } from "@/components/commercial/OperationalInvoicesPanel";
import { useCommercialAccount } from "@/hooks/use-commercial";
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
  canUploadDocuments: boolean;
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
  canUploadDocuments,
}: CommercialConsoleProps) {
  const tenantId = String(tenant.tenantId);
  const needsCommercialAccount =
    canReadAccount || canReadContacts || canReadContracts || canReadInvoices;
  const { data: account } = useCommercialAccount(needsCommercialAccount ? tenantId : undefined);
  const canUploadContracts = canWriteContracts || canUploadDocuments;

  return (
    <div className="space-y-6" data-testid="commercial-console">
      <div className="flex items-start gap-2 p-3 rounded-md bg-muted/40 border border-border text-xs text-muted-foreground">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          Operational commercial tracking — store contracts and invoice PDFs, track renewal and payment
          reminders for platform operators. No billing engine, payment collection, or accounting.
        </span>
      </div>

      {(canReadAccount || canReadContacts) && (
        <section className="rounded-lg border border-border bg-card p-4">
          <h4 className="text-sm font-semibold mb-3">Commercial account</h4>
          <CommercialAccountSection
            tenantId={tenantId}
            canReadAccount={canReadAccount}
            canWriteAccount={canWriteAccount}
            canReadContacts={canReadContacts}
            canWriteContacts={canWriteContacts}
          />
        </section>
      )}

      {canReadContracts && (
        <section className="rounded-lg border border-border bg-card p-4" data-testid="commercial-console-section-contracts">
          <OperationalContractsPanel
            tenantId={tenantId}
            commercialAccountId={account?.id}
            canWrite={canWriteContracts}
            canUpload={canUploadContracts}
          />
        </section>
      )}

      {canReadInvoices && (
        <section className="rounded-lg border border-border bg-card p-4" data-testid="commercial-console-section-invoices">
          <OperationalInvoicesPanel
            tenantId={tenantId}
            commercialAccountId={account?.id}
            canWrite={canWriteInvoices}
            canUpload={canUploadDocuments}
          />
        </section>
      )}
    </div>
  );
}
