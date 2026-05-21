/**
 * @file   pages/super-admin-governance.tsx
 * @phase  P12-A - Governance Dashboard Shell & Navigation Foundations
 *
 * Governance Console overview dashboard shell.
 * Read-only - no mutation controls.
 */

import { Link } from "wouter";
import {
  ShieldCheck, LinkIcon, AlertTriangle, GitBranch,
  BarChart3, Network, Package, ArrowRight, Eye,
  CheckCircle2, Clock, XCircle, Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useGovernanceOverview } from "@/lib/governance-console-hooks";
import { GovernanceReadOnlyNotice } from "@/components/governance/governance-read-only-notice";

// ── Helpers ────────────────────────────────────────────────────────────────

function readinessColor(status: string | undefined): string {
  if (status === "production_ready") return "text-emerald-600 dark:text-emerald-400";
  if (status === "ready")            return "text-blue-600 dark:text-blue-400";
  if (status === "partial")          return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function readinessIcon(status: string | undefined): React.ElementType {
  if (status === "production_ready" || status === "ready") return CheckCircle2;
  if (status === "partial") return Clock;
  return XCircle;
}

function readinessLabel(status: string | undefined): string {
  if (status === "production_ready") return "Production Ready";
  if (status === "ready")            return "Ready";
  if (status === "partial")          return "Partial";
  if (status === "not_ready")        return "Not Ready";
  return "Unknown";
}

// ── Stat Card ──────────────────────────────────────────────────────────────

function StatCard({
  title,
  value,
  icon: Icon,
  color = "text-primary",
  loading = false,
  sub,
}: {
  title: string;
  value?: string | number;
  icon: React.ElementType;
  color?: string;
  loading?: boolean;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            {loading ? (
              <Skeleton className="h-8 w-20 mt-1" />
            ) : (
              <p className="text-2xl font-bold mt-1">{value ?? "-"}</p>
            )}
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <div className={`p-2.5 rounded-lg bg-muted ${color}`}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Quick-link card ────────────────────────────────────────────────────────

interface GovernanceSection {
  href: string;
  icon: React.ElementType;
  title: string;
  description: string;
  color: string;
}

const GOVERNANCE_SECTIONS: GovernanceSection[] = [
  {
    href: "/super-admin/governance/audit-integrity",
    icon: LinkIcon,
    title: "Audit Integrity",
    description: "Hash-linked audit chain verification and forensic timeline reconstruction.",
    color: "text-blue-600 dark:text-blue-400",
  },
  {
    href: "/super-admin/governance/violations",
    icon: AlertTriangle,
    title: "Policy Violations",
    description: "8-policy governance evaluation - detect and classify violations by severity.",
    color: "text-amber-600 dark:text-amber-400",
  },
  {
    href: "/super-admin/governance/workflows",
    icon: GitBranch,
    title: "Workflows",
    description: "Human-governed 6-state lifecycle for violation investigation and resolution.",
    color: "text-violet-600 dark:text-violet-400",
  },
  {
    href: "/super-admin/governance/analytics",
    icon: BarChart3,
    title: "Analytics",
    description: "13-metric governance health profile - escalation rates, throughput, stability.",
    color: "text-emerald-600 dark:text-emerald-400",
  },
  {
    href: "/super-admin/governance/topology",
    icon: Network,
    title: "Topology & Readiness",
    description: "Cross-layer boundary verification and platform governance readiness verdict.",
    color: "text-cyan-600 dark:text-cyan-400",
  },
  {
    href: "/super-admin/governance/evidence-packages",
    icon: Package,
    title: "Evidence Packages",
    description: "Scope-filtered, integrity-hashed evidence bundles for audit review.",
    color: "text-rose-600 dark:text-rose-400",
  },
];

// ── Main page ──────────────────────────────────────────────────────────────

export default function SuperAdminGovernance() {
  const { readiness, violations, workflows, analytics, isLoading } = useGovernanceOverview();

  const readinessStatus  = (readiness.data as any)?.readiness?.overallStatus as string | undefined;
  const violationsData   = (violations.data as any);
  const workflowsData    = (workflows.data as any);
  const analyticsProfile = (analytics.data as any)?.profile;

  const ReadinessIcon = readinessIcon(readinessStatus);

  return (
    <div className="space-y-8" data-testid="governance-dashboard-shell">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Governance Console</h1>
          </div>
          <p className="text-muted-foreground text-sm">
            Platform-wide compliance governance - audit integrity, policy enforcement, and evidence packaging.
          </p>
        </div>
        <Badge variant="outline" className="gap-1.5 text-xs border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-400 shrink-0">
          <Eye className="w-3 h-3" />
          Read-Only Review
        </Badge>
      </div>

      <GovernanceReadOnlyNotice />

      {/* Readiness banner */}
      {(isLoading || readinessStatus) && (
        <Card className="border-2 border-dashed">
          <CardContent className="pt-5">
            <div className="flex items-center gap-4">
              {isLoading ? (
                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className={`w-10 h-10 rounded-full bg-muted flex items-center justify-center ${readinessColor(readinessStatus)}`}>
                  <ReadinessIcon className="w-5 h-5" />
                </div>
              )}
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Governance Readiness</p>
                {isLoading ? (
                  <Skeleton className="h-6 w-36 mt-1" />
                ) : (
                  <p className={`text-xl font-bold ${readinessColor(readinessStatus)}`}>
                    {readinessLabel(readinessStatus)}
                  </p>
                )}
              </div>
              <div className="ml-auto">
                <Link href="/super-admin/governance/topology">
                  <span className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                    View details <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Active Workflows"
          value={workflowsData?.total}
          icon={GitBranch}
          color="text-violet-600"
          loading={isLoading}
          sub="open investigations"
        />
        <StatCard
          title="Policy Violations"
          value={violationsData?.violations?.length}
          icon={AlertTriangle}
          color="text-amber-600"
          loading={isLoading}
          sub="detected violations"
        />
        <StatCard
          title="Stability Score"
          value={analyticsProfile?.workflowStabilityScore ?? "-"}
          icon={BarChart3}
          color="text-emerald-600"
          loading={isLoading}
          sub="workflow effectiveness"
        />
        <StatCard
          title="Critical Unresolved"
          value={analyticsProfile?.unresolvedCriticalCount}
          icon={ShieldCheck}
          color="text-rose-600"
          loading={isLoading}
          sub="require attention"
        />
      </div>

      {/* Section cards */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
          Governance Sections
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {GOVERNANCE_SECTIONS.map((section) => (
            <Link key={section.href} href={section.href}>
              <Card className="cursor-pointer hover:border-primary/50 hover:shadow-sm transition-all group">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <div className={`p-1.5 rounded-md bg-muted ${section.color}`}>
                      <section.icon className="w-4 h-4" />
                    </div>
                    <span className="group-hover:text-primary transition-colors">{section.title}</span>
                    <ArrowRight className="w-3 h-3 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-xs text-muted-foreground leading-relaxed">{section.description}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>

    </div>
  );
}
