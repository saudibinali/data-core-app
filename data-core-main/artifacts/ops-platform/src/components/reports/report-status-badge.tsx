import { Badge } from "@/components/ui/badge";
import { FORMAT_LABELS, REPORT_STATUS_LABELS } from "@/lib/report-center-config";

export function ReportStatusBadge({
  status,
  isAr,
}: {
  status: string;
  isAr: boolean;
}) {
  const cfg = REPORT_STATUS_LABELS[status] ?? {
    en: status,
    ar: status,
    variant: "outline" as const,
  };
  return <Badge variant={cfg.variant}>{isAr ? cfg.ar : cfg.en}</Badge>;
}

export function FormatBadge({ format }: { format: string }) {
  return <Badge variant="outline">{FORMAT_LABELS[format] ?? format.toUpperCase()}</Badge>;
}
