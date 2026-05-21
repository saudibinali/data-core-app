/**
 * @phase P15-G - Cross-section commercial overview cards (computed from existing APIs)
 */

import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useCommercialAccount } from "@/hooks/use-commercial";
import { useTenantCommercialContracts } from "@/hooks/use-commercial-contracts";
import { useTenantCommercialInvoices, type CommercialInvoice } from "@/hooks/use-commercial-invoices";
import { useTenantCommercialRisk } from "@/hooks/use-commercial-risk";
import {
  COMMERCIAL_ACCOUNT_STATUS_CONFIG,
  COMMERCIAL_INVOICE_STATUS_CONFIG,
  COMMERCIAL_RISK_LEVEL_CONFIG,
  RENEWAL_READINESS_CONFIG,
  type CommercialAccountStatus,
  type CommercialInvoiceStatus,
} from "@/lib/commercial-config";

interface Props {
  tenantId: string;
  canReadAccount: boolean;
  canReadContracts: boolean;
  canReadInvoices: boolean;
  canReadRisk: boolean;
}

function SummaryCard({
  label,
  value,
  loading,
}: {
  label: string;
  value: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <Card data-testid={`commercial-overview-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardContent className="pt-3 pb-3">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin mt-1" />
        ) : (
          <div className="mt-1 text-sm font-semibold">{value ?? "-"}</div>
        )}
      </CardContent>
    </Card>
  );
}

export function CommercialOverviewSummary({
  tenantId,
  canReadAccount,
  canReadContracts,
  canReadInvoices,
  canReadRisk,
}: Props) {
  const { data: account, isLoading: accountLoading } = useCommercialAccount(
    canReadAccount ? tenantId : undefined,
  );
  const { data: contracts = [], isLoading: contractsLoading } = useTenantCommercialContracts(
    canReadContracts ? tenantId : undefined,
  );
  const { data: invoices = [], isLoading: invoicesLoading } = useTenantCommercialInvoices(
    canReadInvoices ? tenantId : undefined,
  );
  const { data: risk, isLoading: riskLoading } = useTenantCommercialRisk(
    tenantId,
    canReadRisk,
  );

  const activeContract = contracts.find(c => c.status === "active");
  const latestInvoice: CommercialInvoice | undefined = [...invoices].sort((a, b) =>
    (b.invoiceDate ?? "").localeCompare(a.invoiceDate ?? ""),
  )[0];

  const accountStatus = account
    ? (COMMERCIAL_ACCOUNT_STATUS_CONFIG[account.status as CommercialAccountStatus]?.label ?? account.status)
    : "-";

  const collectionLabel = risk
    ? (Number(risk.signals.outstandingAmount) > 0
      ? `Outstanding ${risk.signals.outstandingAmount}`
      : "Clear")
    : latestInvoice
      ? (COMMERCIAL_INVOICE_STATUS_CONFIG[latestInvoice.status as CommercialInvoiceStatus]?.label
        ?? latestInvoice.status)
      : "-";

  return (
    <div
      className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2"
      data-testid="commercial-overview-summary"
    >
      {canReadAccount && (
        <SummaryCard label="Account Status" value={accountStatus} loading={accountLoading} />
      )}
      {canReadContracts && (
        <SummaryCard
          label="Active Contract"
          value={activeContract?.contractTitle ?? activeContract?.contractNumber ?? "None"}
          loading={contractsLoading}
        />
      )}
      {canReadContracts && (
        <SummaryCard
          label="Renewal Date"
          value={activeContract?.renewalDate ?? "-"}
          loading={contractsLoading}
        />
      )}
      {canReadInvoices && (
        <SummaryCard
          label="Latest Invoice"
          value={latestInvoice?.invoiceNumber ?? "-"}
          loading={invoicesLoading}
        />
      )}
      {(canReadRisk || canReadInvoices) && (
        <SummaryCard
          label="Outstanding"
          value={risk?.signals.outstandingAmount ?? "-"}
          loading={riskLoading && canReadRisk}
        />
      )}
      {(canReadRisk || canReadInvoices) && (
        <SummaryCard label="Collection State" value={collectionLabel} loading={false} />
      )}
      {canReadRisk && risk && (
        <SummaryCard
          label="Risk Level"
          value={
            <Badge variant={COMMERCIAL_RISK_LEVEL_CONFIG[risk.riskLevel].variant}>
              {COMMERCIAL_RISK_LEVEL_CONFIG[risk.riskLevel].label}
            </Badge>
          }
          loading={riskLoading}
        />
      )}
      {canReadRisk && risk && (
        <SummaryCard
          label="Renewal Readiness"
          value={
            <Badge variant={RENEWAL_READINESS_CONFIG[risk.renewalReadinessStatus].variant}>
              {RENEWAL_READINESS_CONFIG[risk.renewalReadinessStatus].label}
            </Badge>
          }
          loading={riskLoading}
        />
      )}
    </div>
  );
}
