/**
 * @phase P15-G - Risk & readiness integrated in commercial console
 */

import { Link } from "wouter";
import { ShieldAlert, Loader2, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useTenantCommercialRisk } from "@/hooks/use-commercial-risk";
import {
  COMMERCIAL_RISK_LEVEL_CONFIG,
  RENEWAL_READINESS_CONFIG,
  RISK_REASON_LABELS,
  RECOMMENDED_ACTION_LABELS,
} from "@/lib/commercial-config";

interface Props {
  tenantId: string;
}

export function CommercialRiskSection({ tenantId }: Props) {
  const { data: risk, isLoading, isError } = useTenantCommercialRisk(tenantId, true);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-4" data-testid="commercial-risk-section-loading">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading risk assessment...
      </div>
    );
  }

  if (isError || !risk) {
    return (
      <p className="text-xs text-destructive" data-testid="commercial-risk-section-error">
        Unable to load commercial risk data.
      </p>
    );
  }

  return (
    <div className="space-y-4 text-xs" data-testid="commercial-risk-section">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={COMMERCIAL_RISK_LEVEL_CONFIG[risk.riskLevel].variant}>
          Risk: {COMMERCIAL_RISK_LEVEL_CONFIG[risk.riskLevel].label}
        </Badge>
        <Badge variant={RENEWAL_READINESS_CONFIG[risk.renewalReadinessStatus].variant}>
          Readiness: {RENEWAL_READINESS_CONFIG[risk.renewalReadinessStatus].label}
        </Badge>
        <Link
          href="/super-admin/commercial-risk"
          className="inline-flex items-center gap-1 text-primary hover:underline ml-auto text-xs"
          data-testid="commercial-open-full-risk-view"
        >
          <ShieldAlert className="w-3 h-3" />
          Open Full Risk View
          <ExternalLink className="w-3 h-3" />
        </Link>
      </div>

      <div>
        <p className="font-medium mb-1">Signals</p>
        <ul className="list-disc ps-4 text-muted-foreground space-y-0.5">
          <li>Active contract: {risk.signals.activeContractExists ? "Yes" : "No"}</li>
          <li>Outstanding: {risk.signals.outstandingAmount}</li>
          <li>Overdue invoices: {risk.signals.overdueInvoiceCount}</li>
          <li>Days to renewal: {risk.signals.daysUntilRenewalDate ?? "-"}</li>
        </ul>
      </div>

      {risk.reasons.length > 0 && (
        <div>
          <p className="font-medium mb-1">Reasons</p>
          <ul className="list-disc ps-4 text-muted-foreground">
            {risk.reasons.map(r => (
              <li key={r}>{RISK_REASON_LABELS[r]?.en ?? r}</li>
            ))}
          </ul>
        </div>
      )}

      {risk.recommendedActions.length > 0 && (
        <div>
          <p className="font-medium mb-1">Recommended actions (read-only)</p>
          <ul className="list-disc ps-4 text-muted-foreground">
            {risk.recommendedActions.map(a => (
              <li key={a}>{RECOMMENDED_ACTION_LABELS[a]?.en ?? a}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

