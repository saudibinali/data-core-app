/**
 * @phase P15-G - Collection tracking section (manual payments, read-only summary)
 */

import { Banknote } from "lucide-react";
import { CollectionTrackingPanel } from "@/components/commercial/CollectionTrackingPanel";
import type { CommercialInvoice } from "@/hooks/use-commercial-invoices";

interface Props {
  tenantId: string;
  commercialAccountId: number | undefined;
  selectedInvoice: CommercialInvoice | null;
  canRecord: boolean;
  canVerify: boolean;
  onClose: () => void;
}

export function CommercialCollectionSection({
  tenantId,
  commercialAccountId,
  selectedInvoice,
  canRecord,
  canVerify,
  onClose,
}: Props) {
  return (
    <div className="space-y-3" data-testid="commercial-collection-section">
      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <Banknote className="w-3.5 h-3.5" />
        Manual payment records and collection summary - no electronic payment.
      </p>
      {!selectedInvoice && (
        <p className="text-xs text-muted-foreground py-2" data-testid="commercial-collection-empty">
          Open collection tracking from an invoice in Invoices &amp; Documents, or select an invoice there.
        </p>
      )}
      {selectedInvoice && commercialAccountId && (
        <CollectionTrackingPanel
          tenantId={tenantId}
          invoice={selectedInvoice}
          commercialAccountId={commercialAccountId}
          canRecord={canRecord}
          canVerify={canVerify}
          onClose={onClose}
        />
      )}
      {selectedInvoice && !commercialAccountId && (
        <p className="text-xs text-muted-foreground">Commercial account required for collection tracking.</p>
      )}
    </div>
  );
}
