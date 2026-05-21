/**
 * @file   lib/governance-console-hooks.ts
 * @phase  P12-A / P12-B - Governance Dashboard Shell & Audit Integrity UI
 *
 * Read-only TanStack Query hooks for all Phase 11 governance API endpoints.
 *
 * SAFETY CONTRACT:
 *   - Every hook in this file uses useQuery (read-only).
 *   - No useMutation is exported or used anywhere in this file.
 *   - No write, escalate, resolve, or transition operations exist here.
 *   - All queryFn calls use apiClient.get() only.
 *
 * Hooks remain functional even when the backend returns an error -
 * callers receive { data: undefined, isLoading, isError, error } and
 * must render their own error/empty states.
 */

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@workspace/api-client-react";

// ── Query key constants ────────────────────────────────────────────────────

export const GOVERNANCE_QUERY_KEYS = {
  auditChains:           ["governance", "audit-chains"]                    as const,
  auditIntegrity:        ["governance", "audit-integrity"]                 as const,
  policies:              ["governance", "policies"]                        as const,
  violations:            ["governance", "violations"]                      as const,
  workflows:             ["governance", "workflows"]                       as const,
  analytics:             ["governance", "analytics"]                       as const,
  analyticsEffectiveness:["governance", "analytics", "effectiveness"]      as const,
  policyEffectiveness:   ["governance", "analytics", "policy-effectiveness"] as const,
  topology:              ["governance", "topology"]                        as const,
  topologyBoundaries:    ["governance", "topology", "boundaries"]          as const,
  readiness:             ["governance", "readiness"]                       as const,
  evidencePackages:      ["governance", "evidence-packages"]               as const,
  evidenceReadiness:     ["governance", "evidence-packages", "readiness"]  as const,
  topologySnapshot:      ["governance", "topology", "snapshot"]            as const,
} as const;

// ── Shared stale / refresh config ─────────────────────────────────────────

const GOVERNANCE_QUERY_CONFIG = {
  staleTime: 60_000,
  retry: 1,
} as const;

// ── P11-A - Audit Chain Hooks ──────────────────────────────────────────────

export function useGovernanceAuditChains(params?: {
  entityType?: string;
  workspaceId?: string;
  limit?: number;
  offset?: number;
}) {
  const qs = params
    ? "?" + new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)])
      ).toString()
    : "";

  return useQuery({
    queryKey: [...GOVERNANCE_QUERY_KEYS.auditChains, params],
    queryFn: () => apiClient.get<{ entries: unknown[]; total: number; limit: number; offset: number }>(
      `/api/platform/compliance/audit-chains${qs}`
    ).then(r => r.data),
    ...GOVERNANCE_QUERY_CONFIG,
  });
}

export function useGovernanceAuditIntegrity(params?: {
  entityType?: string;
  workspaceId?: string;
}) {
  const qs = params
    ? "?" + new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)])
      ).toString()
    : "";

  return useQuery({
    queryKey: [...GOVERNANCE_QUERY_KEYS.auditIntegrity, params],
    queryFn: () => apiClient.get<{ report: unknown; summary: unknown }>(
      `/api/platform/compliance/audit-integrity${qs}`
    ).then(r => r.data),
    ...GOVERNANCE_QUERY_CONFIG,
  });
}

// ── P12-B - Forensic Timeline Hook ────────────────────────────────────────
// Read-only. Only executes when entityId is provided (non-empty string).
// Calls GET /api/platform/compliance/forensics/:entityId.
// Never writes, never repairs, never deletes.

export function useGovernanceForensicTimeline(entityId?: string) {
  return useQuery({
    queryKey: ["governance", "forensic-timeline", entityId ?? ""],
    queryFn:  () => apiClient.get<{ timeline: unknown[] }>(
      `/api/platform/compliance/forensics/${encodeURIComponent(entityId ?? "")}`
    ).then(r => r.data),
    enabled:   typeof entityId === "string" && entityId.trim().length > 0,
    staleTime: 60_000,
    retry:     1,
  });
}

// ── P11-B - Policy & Violation Hooks ──────────────────────────────────────

export function useGovernancePolicies() {
  return useQuery({
    queryKey: GOVERNANCE_QUERY_KEYS.policies,
    queryFn: () => apiClient.get<{ policies: unknown[] }>(
      "/api/platform/governance/policies"
    ).then(r => r.data),
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

export function useGovernanceViolations(workspaceId?: string) {
  const url = workspaceId
    ? `/api/platform/governance/violations/${workspaceId}`
    : "/api/platform/governance/violations";

  return useQuery({
    queryKey: [...GOVERNANCE_QUERY_KEYS.violations, workspaceId],
    queryFn: () => apiClient.get<{ violations: unknown[]; summary: unknown }>(url).then(r => r.data),
    ...GOVERNANCE_QUERY_CONFIG,
  });
}

// ── P11-C - Workflow Hooks ─────────────────────────────────────────────────

export function useGovernanceWorkflows(params?: {
  workspaceId?: string;
  workflowStatus?: string;
  escalationLevel?: string;
  policyId?: string;
  limit?: number;
  offset?: number;
}) {
  const qs = params
    ? "?" + new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)])
      ).toString()
    : "";

  return useQuery({
    queryKey: [...GOVERNANCE_QUERY_KEYS.workflows, params],
    queryFn: () => apiClient.get<{ workflows: unknown[]; total: number; limit: number; offset: number }>(
      `/api/platform/governance/workflows${qs}`
    ).then(r => r.data),
    ...GOVERNANCE_QUERY_CONFIG,
  });
}

// ── P11-D - Analytics Hooks ───────────────────────────────────────────────

export function useGovernanceAnalytics(workspaceId?: string) {
  const qs = workspaceId ? `?workspaceId=${workspaceId}` : "";
  return useQuery({
    queryKey: [...GOVERNANCE_QUERY_KEYS.analytics, workspaceId],
    queryFn: () => apiClient.get<{ profile: unknown }>(
      `/api/platform/governance/analytics${qs}`
    ).then(r => r.data),
    ...GOVERNANCE_QUERY_CONFIG,
  });
}

export function useGovernanceAnalyticsEffectiveness() {
  return useQuery({
    queryKey: GOVERNANCE_QUERY_KEYS.analyticsEffectiveness,
    queryFn: () => apiClient.get<{ report: unknown }>(
      "/api/platform/governance/analytics/effectiveness"
    ).then(r => r.data),
    ...GOVERNANCE_QUERY_CONFIG,
  });
}

export function useGovernancePolicyEffectiveness(policyId?: string) {
  const qs = policyId ? `?policyId=${policyId}` : "";
  return useQuery({
    queryKey: [...GOVERNANCE_QUERY_KEYS.policyEffectiveness, policyId],
    queryFn: () => apiClient.get<{ profiles: unknown[]; total: number }>(
      `/api/platform/governance/analytics/policy-effectiveness${qs}`
    ).then(r => r.data),
    ...GOVERNANCE_QUERY_CONFIG,
  });
}

// ── P11-E - Topology & Readiness Hooks ────────────────────────────────────

export function useGovernanceTopology() {
  return useQuery({
    queryKey: GOVERNANCE_QUERY_KEYS.topology,
    queryFn: () => apiClient.get<{ topology: unknown }>(
      "/api/platform/governance/topology"
    ).then(r => r.data),
    ...GOVERNANCE_QUERY_CONFIG,
  });
}

export function useGovernanceTopologyBoundaries() {
  return useQuery({
    queryKey: GOVERNANCE_QUERY_KEYS.topologyBoundaries,
    queryFn: () => apiClient.get<{ boundarySummary: unknown }>(
      "/api/platform/governance/topology/boundaries"
    ).then(r => r.data),
    ...GOVERNANCE_QUERY_CONFIG,
  });
}

export function useGovernanceReadiness() {
  return useQuery({
    queryKey: GOVERNANCE_QUERY_KEYS.readiness,
    queryFn: () => apiClient.get<{ readiness: unknown }>(
      "/api/platform/governance/readiness"
    ).then(r => r.data),
    ...GOVERNANCE_QUERY_CONFIG,
  });
}

// ── P11-F - Evidence Package Hooks ────────────────────────────────────────

export function useGovernanceEvidencePackages(scope?: string) {
  const qs = scope ? `?scope=${scope}` : "";
  return useQuery({
    queryKey: [...GOVERNANCE_QUERY_KEYS.evidencePackages, scope],
    queryFn: () => apiClient.get<{ package: unknown }>(
      `/api/platform/governance/evidence-packages${qs}`
    ).then(r => r.data),
    ...GOVERNANCE_QUERY_CONFIG,
  });
}

export function useGovernanceEvidenceReadiness() {
  return useQuery({
    queryKey: GOVERNANCE_QUERY_KEYS.evidenceReadiness,
    queryFn: () => apiClient.get<{ package: unknown }>(
      "/api/platform/governance/evidence-packages/readiness"
    ).then(r => r.data),
    ...GOVERNANCE_QUERY_CONFIG,
  });
}

export function useGovernanceTopologySnapshot() {
  return useQuery({
    queryKey: GOVERNANCE_QUERY_KEYS.topologySnapshot,
    queryFn: () => apiClient.get<{ snapshot: unknown }>(
      "/api/platform/governance/topology/snapshot"
    ).then(r => r.data),
    ...GOVERNANCE_QUERY_CONFIG,
  });
}

// ── Composite hook - governance overview ──────────────────────────────────
// Fetches the minimum set of data needed for the governance dashboard shell.
// Fails gracefully: if any individual query errors, the others still succeed.

export function useGovernanceOverview() {
  const readiness  = useGovernanceReadiness();
  const violations = useGovernanceViolations();
  const workflows  = useGovernanceWorkflows({ limit: 5 });
  const analytics  = useGovernanceAnalytics();

  return {
    readiness,
    violations,
    workflows,
    analytics,
    isLoading: readiness.isLoading || violations.isLoading || workflows.isLoading || analytics.isLoading,
    hasError:  readiness.isError   || violations.isError   || workflows.isError   || analytics.isError,
  };
}
