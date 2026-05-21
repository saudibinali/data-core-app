/**
 * @file   components/governance/governance-evidence-reference-list.tsx
 * @phase  P12-C - Policy Violations UI & Evidence Review Foundations
 *
 * Read-only evidence reference inspection component.
 *
 * SAFETY CONTRACT:
 *   - Displays evidence references only - no download, export, or external links.
 *   - Never creates, dismisses, or modifies any reference.
 *   - Accessible to super_admin only (enforced at route level).
 */

import { Link, Cpu, Camera, ShieldCheck, FileText, ChevronDown, ChevronUp, Hash } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  EVIDENCE_REFERENCE_TYPE_MAP,
  type EvidenceReferenceTypeKey,
} from "@/lib/governance-console-config";

// ── Types ──────────────────────────────────────────────────────────────────

export interface EvidenceReference {
  type?:        string;
  referenceId?: string;
  id?:          string;
  source?:      string;
  layer?:       string;
  description?: string;
}

interface GovernanceEvidenceReferenceListProps {
  references:    EvidenceReference[];
  compact?:      boolean;
  "data-testid"?: string;
}

// ── Icon mapper ────────────────────────────────────────────────────────────

function EvidenceIcon({ iconKey }: { iconKey?: string }) {
  const cls = "w-3.5 h-3.5 shrink-0 text-muted-foreground";
  if (iconKey === "link")   return <Link className={cls} />;
  if (iconKey === "cpu")    return <Cpu className={cls} />;
  if (iconKey === "camera") return <Camera className={cls} />;
  if (iconKey === "shield") return <ShieldCheck className={cls} />;
  return <FileText className={cls} />;
}

// ── Type badge ────────────────────────────────────────────────────────────

function EvidenceTypeBadge({ type }: { type?: string }) {
  const key  = (type ?? "") as EvidenceReferenceTypeKey;
  const info = key in EVIDENCE_REFERENCE_TYPE_MAP ? EVIDENCE_REFERENCE_TYPE_MAP[key] : null;

  if (!info) {
    return (
      <Badge variant="outline" className="text-xs">
        {type ?? "unknown"}
      </Badge>
    );
  }

  const colorMap: Record<EvidenceReferenceTypeKey, string> = {
    audit_chain_entry: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400 border-0",
    execution_record:  "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400 border-0",
    snapshot:          "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-400 border-0",
    policy_evaluation: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-0",
    external_ref:      "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-0",
  };

  return (
    <Badge className={`text-xs gap-1 ${colorMap[key] ?? ""}`} title={info.description}>
      <EvidenceIcon iconKey={info.icon} />
      {info.label}
    </Badge>
  );
}

// ── Single reference row ───────────────────────────────────────────────────

function EvidenceReferenceRow({
  ref: evidence,
  index,
  compact,
}: {
  ref: EvidenceReference;
  index: number;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const refId = evidence.referenceId ?? evidence.id ?? `ref-${index}`;
  const hasDetails = !!(evidence.source || evidence.layer || evidence.description);

  return (
    <div className="border rounded-md overflow-hidden" data-testid={`evidence-ref-${index}`}>
      <div
        className={`flex items-center gap-2 px-3 py-2 text-xs ${hasDetails && !compact ? "cursor-pointer hover:bg-muted transition-colors" : ""}`}
        onClick={() => hasDetails && !compact && setOpen(o => !o)}
        role={hasDetails && !compact ? "button" : undefined}
        tabIndex={hasDetails && !compact ? 0 : undefined}
        aria-expanded={hasDetails && !compact ? open : undefined}
        onKeyDown={e => { if ((e.key === "Enter" || e.key === " ") && hasDetails && !compact) setOpen(o => !o); }}
      >
        <span className="shrink-0 text-muted-foreground font-mono w-5 text-right">
          {String(index + 1).padStart(2, "0")}
        </span>
        <EvidenceTypeBadge type={evidence.type} />
        <span className="flex-1 font-mono text-foreground truncate flex items-center gap-1">
          <Hash className="w-3 h-3 text-muted-foreground shrink-0" />
          {refId}
        </span>
        {hasDetails && !compact && (
          <span className="shrink-0 text-muted-foreground">
            {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </span>
        )}
      </div>

      {open && hasDetails && (
        <div className="border-t bg-muted/30 px-4 py-2 text-xs space-y-1.5">
          {evidence.source && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="font-medium w-14 shrink-0">Source:</span>
              <span className="font-mono text-foreground">{evidence.source}</span>
            </div>
          )}
          {evidence.layer && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="font-medium w-14 shrink-0">Layer:</span>
              <span className="font-mono text-foreground">{evidence.layer}</span>
            </div>
          )}
          {evidence.description && (
            <div className="flex items-start gap-2 text-muted-foreground">
              <span className="font-medium w-14 shrink-0 mt-0.5">Note:</span>
              <span className="text-foreground">{evidence.description}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function GovernanceEvidenceReferenceList({
  references,
  compact = false,
  "data-testid": testId = "evidence-reference-list",
}: GovernanceEvidenceReferenceListProps) {
  if (references.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground" data-testid={`${testId}-empty`}>
        <FileText className="w-6 h-6 mx-auto mb-2 opacity-20" />
        <p className="text-xs">No evidence references attached to this violation.</p>
      </div>
    );
  }

  // Stable ordering: by type alphabetically, then by referenceId
  const sorted = [...references].sort((a, b) => {
    const typeCompare = (a.type ?? "").localeCompare(b.type ?? "");
    if (typeCompare !== 0) return typeCompare;
    return (a.referenceId ?? a.id ?? "").localeCompare(b.referenceId ?? b.id ?? "");
  });

  return (
    <div className="space-y-1" data-testid={testId}>
      {sorted.map((ref, i) => (
        <EvidenceReferenceRow
          key={ref.referenceId ?? ref.id ?? `ref-${i}`}
          ref={ref}
          index={i}
          compact={compact}
        />
      ))}
      {!compact && (
        <p className="text-xs text-muted-foreground text-right pt-1">
          {references.length} evidence reference{references.length !== 1 ? "s" : ""} - read-only
        </p>
      )}
    </div>
  );
}
