/**
 * F5.2 — Unified leave read/write bridge (canonical-first).
 * Reads: GET /hr/leave-requests (+ legacy admin list only when not frozen).
 * Writes: POST /hr/leave-requests when cutover enabled; else POST /hr/me/leave-requests.
 */

import type { AxiosInstance } from "axios";
import type { LeaveCutoverStatus } from "@/lib/leave-cutover-flags";

export type LeaveSource = "canonical" | "legacy";

/** Unified row shape for list UIs */
export type NormalizedLeaveRow = {
  id: number;
  source: LeaveSource;
  leaveType: string;
  startDate: string;
  endDate: string;
  daysCount: number | null;
  status: string;
  reason: string | null;
  employeeName?: string;
  employeeId?: number;
  requestNumber?: string;
  /** Legacy PATCH /hr/attendance/leaves/:id — only when source=legacy */
  legacyApproveId?: number;
};

export const LEAVE_STATUS_UI: Record<string, { label: string; labelAr: string; color: string }> = {
  pending:            { label: "Pending",            labelAr: "قيد الانتظار", color: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },
  pending_approval:   { label: "Pending Approval",   labelAr: "بانتظار الموافقة", color: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },
  approved:           { label: "Approved",           labelAr: "موافق عليه",   color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  rejected:           { label: "Rejected",           labelAr: "مرفوض",        color: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
  withdrawn:          { label: "Withdrawn",          labelAr: "مسحوب",         color: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
  cancelled:          { label: "Cancelled",          labelAr: "ملغى",          color: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
};

export function normalizeCanonicalLeave(row: Record<string, unknown>): NormalizedLeaveRow {
  const id = Number(row.id);
  return {
    id,
    source: "canonical",
    leaveType: String(row.leaveType ?? "annual"),
    startDate: String(row.startDate),
    endDate: String(row.endDate),
    daysCount: row.businessDaysCount != null
      ? Number(row.businessDaysCount)
      : row.daysRequested != null
        ? Number(row.daysRequested)
        : null,
    status: String(row.status),
    reason: row.employeeNote != null ? String(row.employeeNote) : null,
    employeeName: row.employeeName != null ? String(row.employeeName) : undefined,
    employeeId: row.employeeId != null ? Number(row.employeeId) : undefined,
    requestNumber: row.requestNumber != null ? String(row.requestNumber) : undefined,
  };
}

export function normalizeLegacyLeave(row: Record<string, unknown>): NormalizedLeaveRow {
  const id = Number(row.id);
  return {
    id,
    source: "legacy",
    leaveType: String(row.leaveType ?? "annual"),
    startDate: String(row.startDate),
    endDate: String(row.endDate),
    daysCount: row.daysCount != null ? Number(row.daysCount) : null,
    status: String(row.status),
    reason: row.reason != null ? String(row.reason) : null,
    employeeName: row.employeeName != null ? String(row.employeeName) : undefined,
    employeeId: row.employeeId != null ? Number(row.employeeId) : undefined,
    legacyApproveId: id,
  };
}

function sortByDateDesc(a: NormalizedLeaveRow, b: NormalizedLeaveRow): number {
  return b.startDate.localeCompare(a.startDate);
}

export type FetchLeaveListOptions = {
  status?: string;
  employeeId?: number;
  /** HR admin: merge legacy list only when legacy is not frozen */
  includeLegacyAdmin?: boolean;
  cutover?: Pick<LeaveCutoverStatus, "legacyFreeze" | "canonicalRead">;
};

/**
 * Canonical-first read: GET /hr/leave-requests; optional legacy admin merge.
 */
export async function fetchLeaveListBridge(
  api: AxiosInstance,
  options: FetchLeaveListOptions = {},
): Promise<NormalizedLeaveRow[]> {
  const params = new URLSearchParams();
  if (options.status && options.status !== "__all__") params.set("status", options.status);
  if (options.employeeId) params.set("employeeId", String(options.employeeId));

  const canonicalQs = params.toString();
  const merged: NormalizedLeaveRow[] = [];

  const readCanonical = options.cutover?.canonicalRead !== false;
  if (readCanonical) {
    try {
      const res = await api.get(
        `/api/hr/leave-requests${canonicalQs ? `?${canonicalQs}` : ""}`,
      );
      const rows = (res.data ?? []) as Record<string, unknown>[];
      merged.push(...rows.map(normalizeCanonicalLeave));
    } catch {
      /* canonical unavailable */
    }
  }

  const legacyFrozen = options.cutover?.legacyFreeze ?? false;
  if (options.includeLegacyAdmin && !legacyFrozen) {
    try {
      const legacyParams = new URLSearchParams();
      if (options.status && options.status !== "__all__") {
        const legacyStatus = options.status === "pending_approval" ? "pending" : options.status;
        legacyParams.set("status", legacyStatus);
      }
      if (options.employeeId) legacyParams.set("employeeId", String(options.employeeId));
      const legRes = await api.get(
        `/api/hr/attendance/leaves${legacyParams.toString() ? `?${legacyParams}` : ""}`,
      );
      const legRows = (legRes.data ?? []) as Record<string, unknown>[];
      const canonicalIds = new Set(merged.map((r) => r.id));
      for (const row of legRows.map(normalizeLegacyLeave)) {
        if (!canonicalIds.has(row.id)) merged.push(row);
      }
    } catch {
      /* legacy admin path requires hr.manage */
    }
  }

  return merged.sort(sortByDateDesc);
}

export type SubmitLeavePayload = {
  leaveType: string;
  startDate: string;
  endDate: string;
  reason?: string;
  leavePolicyId?: number | string | null;
  daysCount?: number;
};

/** Single write path for self-service leave submit (F5.2). */
export async function submitLeaveViaBridge(
  api: AxiosInstance,
  body: SubmitLeavePayload,
  cutover: Pick<LeaveCutoverStatus, "canonicalSubmit">,
): Promise<unknown> {
  if (cutover.canonicalSubmit) {
    const policyId = body.leavePolicyId != null && body.leavePolicyId !== "__none__"
      ? Number(body.leavePolicyId)
      : undefined;
    const res = await api.post("/api/hr/leave-requests", {
      leaveType: body.leaveType,
      startDate: body.startDate,
      endDate: body.endDate,
      employeeNote: body.reason ?? undefined,
      leavePolicyId: policyId,
    });
    return res.data;
  }
  const res = await api.post("/api/hr/me/leave-requests", body);
  return res.data;
}

/** Employee self-service policies (no hr.view). */
export async function fetchMeLeavePolicies(api: AxiosInstance): Promise<Record<string, unknown>[]> {
  const res = await api.get("/api/hr/me/leave-policies");
  return (res.data ?? []) as Record<string, unknown>[];
}
