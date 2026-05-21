/**
 * @phase P17-D - Access Review hooks
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ACCESS_REVIEW_API } from "./platform-access-review-config";

function getAuthToken(): string | null {
  return localStorage.getItem("ops_access_token");
}

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token
    ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
    : { "Content-Type": "application/json" };
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `GET ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? `POST ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface AccessReviewSummary {
  totalPlatformUsers: number;
  activeUsers: number;
  disabledUsers: number;
  suspendedUsers: number;
  rootOwners: number;
  platformOwners: number;
  protectedUsers: number;
  usersWithCustomOverrides: number;
  usersWithCustomGrants: number;
  usersWithCustomDenies: number;
  usersWithCriticalPermissions: number;
  usersMissingRecentReview: number;
  highRiskUsers: HighRiskUserRow[];
  staleUsers: HighRiskUserRow[];
  generatedAt: string;
}

export interface HighRiskUserRow {
  userId: string;
  displayName: string;
  email: string | null;
  userType: string | null;
  roleCode: string;
  status: string;
  riskLevel: string;
  protectionReasons: string[];
  criticalPermissionsCount: number;
  customOverridesCount: number;
  lastLoginAt: string | null;
  lastPermissionChangeAt: string | null;
  lastStatusChangeAt: string | null;
}

export interface UserAccessReviewDetail {
  user: {
    id: string;
    email: string | null;
    displayName: string;
    userType: string | null;
    roleCode: string;
    status: string;
    isRootOwner: boolean;
    isProtected: boolean;
  };
  protectionReasons: string[];
  rolePermissions: string[];
  grantedOverrides: string[];
  deniedOverrides: string[];
  effectivePermissions: string[];
  criticalPermissions: string[];
  sensitivePermissionFlags: Record<string, boolean>;
  lastLoginAt: string | null;
  createdAt: string;
  lastPermissionChangeAt: string | null;
  lastStatusChangeAt: string | null;
  recentAuditEvents: AuditEventRow[];
  riskLevel: string;
  reviewNotes: string | null;
  reviewStatus: string | null;
  reviewedAt: string | null;
  generatedAt: string;
}

export interface AuditEventRow {
  id: number;
  actorId: number | null;
  actorEmail: string | null;
  actorDisplayName: string | null;
  targetUserId: string | null;
  action: string;
  actionLabel: string;
  severity: string;
  result: string | null;
  blockedReason: string | null;
  reason: string | null;
  metadataSafe: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditEventsResponse {
  events: AuditEventRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface AuditEventFilters {
  userId?: string;
  actorId?: string;
  action?: string;
  severity?: string;
  dateFrom?: string;
  dateTo?: string;
  permissionCode?: string;
  blockedOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export function useAccessReviewSummary(enabled: boolean) {
  return useQuery({
    queryKey: ["platform-access-review-summary"],
    queryFn: () => getJson<AccessReviewSummary>(ACCESS_REVIEW_API.summary),
    enabled,
  });
}

export function useUserAccessReview(userId: string | null) {
  return useQuery({
    queryKey: ["platform-access-review-user", userId],
    queryFn: () => getJson<UserAccessReviewDetail>(ACCESS_REVIEW_API.userDetail(userId!)),
    enabled: Boolean(userId),
  });
}

export function useAccessReviewAuditEvents(filters: AuditEventFilters, enabled: boolean) {
  const params = new URLSearchParams();
  if (filters.userId) params.set("userId", filters.userId);
  if (filters.actorId) params.set("actorId", filters.actorId);
  if (filters.action) params.set("action", filters.action);
  if (filters.severity) params.set("severity", filters.severity);
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  if (filters.permissionCode) params.set("permissionCode", filters.permissionCode);
  if (filters.blockedOnly) params.set("blockedOnly", "true");
  if (filters.page) params.set("page", String(filters.page));
  if (filters.pageSize) params.set("pageSize", String(filters.pageSize));

  const qs = params.toString();
  const path = qs ? `${ACCESS_REVIEW_API.auditEvents}?${qs}` : ACCESS_REVIEW_API.auditEvents;

  return useQuery({
    queryKey: ["platform-access-review-audit", filters],
    queryFn: () => getJson<AuditEventsResponse>(path),
    enabled,
  });
}

export function useRecordAccessReview(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { reviewStatus: string; reviewNotes?: string }) =>
      postJson(ACCESS_REVIEW_API.recordReview(userId), body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["platform-access-review-summary"] });
      void qc.invalidateQueries({ queryKey: ["platform-access-review-user", userId] });
    },
  });
}
