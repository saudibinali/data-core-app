/**
 * platform-audit-hooks.ts
 *
 * @phase P14-D - Platform User Audit & Activity Tracking
 *
 * React Query hooks for platform activity / audit log read APIs.
 * Read-only - no mutation hooks.
 */

import { useQuery } from "@tanstack/react-query";

// ── Auth token ────────────────────────────────────────────────────────────────

let _tokenGetter: (() => string | null) | null = null;

export function setAuditAuthTokenGetter(fn: () => string | null) {
  _tokenGetter = fn;
}

function getToken(): string | null {
  return _tokenGetter?.() ?? localStorage.getItem("ops_access_token");
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const token = getToken();
  const res = await fetch(url, {
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PlatformAuditItem {
  id: number;
  actorId: number | null;
  actorEmail: string | null;
  actorDisplayName: string | null;
  targetUserId: string | null;
  targetEmail: string | null;
  targetDisplayName: string | null;
  action: string;
  actionLabel: string;
  actionLabelAr: string;
  group: string;
  severity: string;
  result: string;
  reason: string | null;
  blockedReason: string | null;
  resourceType: string | null;
  resourceId: string | null;
  metadataSafe: Record<string, unknown> | null;
  createdAt: string;
}

export interface PlatformActivityResponse {
  items: PlatformAuditItem[];
  nextCursor: number | null;
}

// ── Filter types ──────────────────────────────────────────────────────────────

export interface PlatformActivityFilters {
  actorId?: string;
  targetUserId?: string;
  action?: string;
  group?: string;
  result?: string;
  severity?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: number;
}

// ── usePlatformActivity ───────────────────────────────────────────────────────

export function usePlatformActivity(filters: PlatformActivityFilters = {}) {
  return useQuery<PlatformActivityResponse>({
    queryKey: ["platform", "activity", filters],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      if (filters.actorId)     params.set("actorId",     filters.actorId);
      if (filters.targetUserId) params.set("targetUserId", filters.targetUserId);
      if (filters.action)      params.set("action",      filters.action);
      if (filters.group)       params.set("group",       filters.group);
      if (filters.result)      params.set("result",      filters.result);
      if (filters.severity)    params.set("severity",    filters.severity);
      if (filters.from)        params.set("from",        filters.from);
      if (filters.to)          params.set("to",          filters.to);
      if (filters.limit)       params.set("limit",       String(filters.limit));
      if (filters.cursor)      params.set("cursor",      String(filters.cursor));
      const qs = params.toString();
      return fetchJson<PlatformActivityResponse>(
        `/api/platform/activity${qs ? `?${qs}` : ""}`,
        signal,
      );
    },
    staleTime: 30_000,
  });
}

// ── usePlatformUserActivity ───────────────────────────────────────────────────

export function usePlatformUserActivity(
  userId: string | null | undefined,
  filters: Pick<PlatformActivityFilters, "limit" | "cursor"> = {},
) {
  return useQuery<PlatformActivityResponse>({
    queryKey: ["platform", "users", userId, "activity", filters],
    enabled: !!userId,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      if (filters.limit)  params.set("limit",  String(filters.limit));
      if (filters.cursor) params.set("cursor", String(filters.cursor));
      const qs = params.toString();
      return fetchJson<PlatformActivityResponse>(
        `/api/platform/users/${userId}/activity${qs ? `?${qs}` : ""}`,
        signal,
      );
    },
    staleTime: 30_000,
  });
}
