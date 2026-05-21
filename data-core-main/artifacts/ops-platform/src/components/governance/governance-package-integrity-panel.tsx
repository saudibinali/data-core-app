/**
 * @file   components/governance/governance-package-integrity-panel.tsx
 * @phase  P12-G - Evidence Packages UI & Controlled Package Review Foundations
 *
 * Read-only package integrity display.
 * Shows hash, generatedAt, integrityStatus, warnings.
 * No verify button, no repair button, no notarization, no blockchain.
 *
 * SAFETY CONTRACT: read-only - critical visibility only for compromised packages.
 */

import { useState } from "react";
import {
  Lock, AlertTriangle, ShieldAlert, CheckCircle2,
  HelpCircle, ChevronDown, ChevronUp,
} from "lucide-react";
import { Badge }    from "@/components/ui/badge";
import { Button }   from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PACKAGE_INTEGRITY_STATUS_MAP,
  type PackageIntegrityStatusKey,
} from "@/lib/governance-console-config";

// ── Types ──────────────────────────────────────────────────────────────────

export interface PackageIntegrityInfo {
  packageIntegrityHash?:  string;
  integrityStatus?:       string;
  generatedAt?:           string;
  capturedAt?:            string;
  warningCodes?:          string[];
  warnings?:              Array<{ code?: string; message: string }>;
  hashAlgorithm?:         string;
  serializationNotes?:    string;
  readinessNotes?:        string;
}

interface GovernancePackageIntegrityPanelProps {
  info:            PackageIntegrityInfo | null | undefined;
  isLoading?:      boolean;
  "data-testid"?:  string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDate(s?: string | null): string {
  if (!s) return "-";
  try { return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(s)); }
  catch { return s; }
}

function truncateHash(h?: string | null, len = 20): string {
  if (!h) return "-";
  return h.length > len ? `${h.slice(0, len)}...` : h;
}

// ── Status icon ────────────────────────────────────────────────────────────

function IntegrityStatusIcon({ status }: { status?: string }) {
  if (status === "verified")    return <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />;
  if (status === "compromised") return <ShieldAlert  className="w-4 h-4 text-red-500 shrink-0"     />;
  if (status === "warning")     return <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0"  />;
  if (status === "incomplete")  return <AlertTriangle className="w-4 h-4 text-slate-400 shrink-0"  />;
  return                               <HelpCircle    className="w-4 h-4 text-muted-foreground shrink-0" />;
}

function IntegrityStatusBadge({ status }: { status?: string }) {
  const key  = (status ?? "") as PackageIntegrityStatusKey;
  const info = key in PACKAGE_INTEGRITY_STATUS_MAP ? PACKAGE_INTEGRITY_STATUS_MAP[key] : null;
  if (!info) return <Badge variant="outline" className="text-xs">{status ?? "Unknown"}</Badge>;
  return (
    <Badge className={`text-xs ${info.badgeClass}`} title={info.description}>
      {info.label}
    </Badge>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function GovernancePackageIntegrityPanel({
  info,
  isLoading = false,
  "data-testid": testId = "package-integrity-panel",
}: GovernancePackageIntegrityPanelProps) {
  const [hashExpanded, setHashExpanded] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid={`${testId}-loading`}>
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}
      </div>
    );
  }

  if (!info) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-muted-foreground"
        data-testid={`${testId}-empty`}>
        <Lock className="w-5 h-5 mb-1.5 opacity-20" />
        <p className="text-xs">No integrity data available for this package.</p>
      </div>
    );
  }

  const status       = info.integrityStatus;
  const isCompromised = status === "compromised";
  const isWarning    = status === "warning";
  const hash         = info.packageIntegrityHash;
  const algo         = info.hashAlgorithm ?? "SHA-256";
  const generatedAt  = info.generatedAt ?? info.capturedAt;
  const allWarnings  = [
    ...(info.warnings ?? []),
    ...(info.warningCodes ?? []).map(c => ({ code: c, message: c })),
  ];

  return (
    <div data-testid={testId}
      className={isCompromised ? "rounded-md border-2 border-red-400 p-3 bg-red-50 dark:bg-red-950/20" : ""}>

      {/* Status row */}
      <div className="flex items-center gap-2 mb-3">
        <IntegrityStatusIcon status={status} />
        <span className="text-sm font-medium">Package Integrity</span>
        <IntegrityStatusBadge status={status} />
        {isCompromised && (
          <span className="text-xs text-red-600 dark:text-red-400 ml-1">
            - Critical visibility only · No automated repair
          </span>
        )}
      </div>

      {/* Metadata grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs mb-3">
        {[
          { label: "Status",        value: status?.replace(/_/g, " ") },
          { label: "Generated At",  value: fmtDate(generatedAt) },
          { label: "Hash Algorithm",value: algo },
          { label: "Hash Preview",  value: truncateHash(hash, 24) },
        ].map(({ label, value }) => (
          <div key={label} className="flex justify-between py-1 border-b border-border last:border-0">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-mono font-medium">{value ?? "-"}</span>
          </div>
        ))}
      </div>

      {/* Full hash - collapsible */}
      {hash && (
        <div className="mb-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Lock className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">{algo} Integrity Hash</span>
            <Button
              variant="ghost" size="sm"
              className="ml-auto h-5 px-2 text-xs text-muted-foreground gap-1"
              onClick={() => setHashExpanded(v => !v)}
            >
              {hashExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {hashExpanded ? "Hide" : "Show full hash"}
            </Button>
          </div>
          {hashExpanded && (
            <p className="font-mono text-xs bg-muted px-3 py-2 rounded-md break-all text-muted-foreground select-all"
              data-testid="full-hash-block">
              {hash}
            </p>
          )}
        </div>
      )}

      {/* Warnings */}
      {allWarnings.length > 0 && (
        <div className={`rounded-md px-3 py-2 space-y-1 ${isWarning || isCompromised ? "bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800" : "bg-muted"}`}>
          <p className="text-xs font-medium text-amber-700 dark:text-amber-400 flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            {allWarnings.length} warning{allWarnings.length !== 1 ? "s" : ""}
          </p>
          {allWarnings.map((w, i) => (
            <p key={i} className="text-xs text-muted-foreground">
              {w.code && <span className="font-mono text-foreground mr-1">[{w.code}]</span>}
              {w.message}
            </p>
          ))}
        </div>
      )}

      {/* Serialization / readiness notes */}
      {(info.serializationNotes || info.readinessNotes) && (
        <div className="mt-3 space-y-1 text-xs text-muted-foreground">
          {info.serializationNotes && <p><span className="font-medium">Serialization:</span> {info.serializationNotes}</p>}
          {info.readinessNotes     && <p><span className="font-medium">Readiness:</span> {info.readinessNotes}</p>}
        </div>
      )}

      <p className="text-xs text-muted-foreground mt-3">
        Read-only integrity inspection · No verify or repair controls
      </p>
    </div>
  );
}
