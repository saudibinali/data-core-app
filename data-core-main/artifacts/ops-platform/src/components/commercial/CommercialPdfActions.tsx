/**
 * Visible PDF upload / download / replace actions for operational commercial records.
 */

import { Upload, Download, FileWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  hasDocument: boolean;
  busy?: boolean;
  canUpload: boolean;
  canDownload?: boolean;
  onUpload: () => void;
  onDownload: () => void;
  className?: string;
}

export function CommercialPdfActions({
  hasDocument,
  busy,
  canUpload,
  canDownload = true,
  onUpload,
  onDownload,
  className,
}: Props) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)} data-testid="commercial-pdf-actions">
      {hasDocument ? (
        canDownload && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1"
            disabled={busy}
            onClick={onDownload}
            data-testid="commercial-pdf-download-btn"
          >
            <Download className="w-3.5 h-3.5" />
            Download PDF
          </Button>
        )
      ) : (
        <span
          className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400 font-medium"
          data-testid="commercial-pdf-missing-indicator"
        >
          <FileWarning className="w-3.5 h-3.5" />
          Missing PDF
        </span>
      )}
      {canUpload && (
        <Button
          type="button"
          variant={hasDocument ? "outline" : "default"}
          size="sm"
          className="h-8 text-xs gap-1"
          disabled={busy}
          onClick={onUpload}
          data-testid="commercial-pdf-upload-btn"
        >
          <Upload className="w-3.5 h-3.5" />
          {hasDocument ? "Replace PDF" : "Upload PDF"}
        </Button>
      )}
    </div>
  );
}
