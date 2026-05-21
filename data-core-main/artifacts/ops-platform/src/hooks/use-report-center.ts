/**
 * P19-F — Report Center API hooks (token-gated downloads only)
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { downloadWithAuth } from "@workspace/api-client-react";

const BASE = "/api";
const TOKEN_KEY = "ops_access_token";

function getToken(): string | null {
  return typeof localStorage !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
}

function authHeaders(json = true): HeadersInit {
  const token = getToken();
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  if (json) h["Content-Type"] = "application/json";
  return h;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export type ReportDefinition = {
  key: string;
  title: string;
  module: string;
  supportedFormats: string[];
  permission: string;
};

export type GeneratedReportRow = {
  id: number;
  reportDefinitionKey: string;
  format: string;
  status: string;
  fileName: string | null;
  downloadCount: number;
  expiresAt: string | null;
  completedAt: string | null;
  createdAt: string;
  exportJobId: number | null;
};

export type ExportJobRow = {
  id: number;
  reportDefinitionKey: string | null;
  format: string | null;
  status: string;
  progressPercent: number;
  lastError: string | null;
  generatedReportId: number | null;
  createdAt: string;
  completedAt: string | null;
};

export type ScheduledReportRow = {
  id: number;
  reportDefinitionKey: string;
  format: string;
  parametersJson: string | null;
  scheduleCron: string;
  scheduleTimezone: string;
  recipientJson: string | null;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
};

export type WorkspaceBranding = {
  workspaceId: number;
  displayName: string;
  logoUrl: string | null;
  primaryColor: string;
  footerText: string | null;
  locale: string;
  watermarkText: string | null;
};

export type AttachmentRow = {
  id: number;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  classification: string | null;
  isConfidential: boolean;
  currentVersionId: number | null;
  sourceEntityType: string;
  sourceEntityId: string;
  createdAt: string;
};

export const reportCenterKeys = {
  definitions: ["reports", "definitions"] as const,
  generated: (mine?: boolean) => ["reports", "generated", { mine: !!mine }] as const,
  exportJobs: ["reports", "export-jobs"] as const,
  exportJob: (id: number) => ["reports", "export-jobs", id] as const,
  schedules: ["reports", "schedules"] as const,
  branding: ["reports", "branding"] as const,
  attachments: (entityType: string, entityId: string) =>
    ["attachments", entityType, entityId] as const,
};

export function useReportDefinitions(enabled = true) {
  return useQuery({
    queryKey: reportCenterKeys.definitions,
    enabled,
    queryFn: () => apiFetch<ReportDefinition[]>("/reports/definitions"),
  });
}

export function useGeneratedReports(mineOnly = false, enabled = true) {
  return useQuery({
    queryKey: reportCenterKeys.generated(mineOnly),
    enabled,
    queryFn: () =>
      apiFetch<GeneratedReportRow[]>(`/reports/generated${mineOnly ? "?mine=true" : ""}`),
  });
}

export function useExportJobs(enabled = true) {
  return useQuery({
    queryKey: reportCenterKeys.exportJobs,
    enabled,
    queryFn: () => apiFetch<ExportJobRow[]>("/reports/export-jobs"),
    refetchInterval: (q) => {
      const rows = q.state.data ?? [];
      const active = rows.some((j) => j.status === "pending" || j.status === "processing");
      return active ? 5000 : false;
    },
  });
}

export function useExportJob(jobId: number | undefined, poll = false) {
  return useQuery({
    queryKey: reportCenterKeys.exportJob(jobId ?? 0),
    enabled: !!jobId && jobId > 0,
    queryFn: () => apiFetch<ExportJobRow & { filterParamsJson?: string }>(`/reports/export-jobs/${jobId}`),
    refetchInterval: poll
      ? (q) => {
          const s = q.state.data?.status;
          return s === "pending" || s === "processing" ? 3000 : false;
        }
      : false,
  });
}

export function useScheduledReports(enabled = true) {
  return useQuery({
    queryKey: reportCenterKeys.schedules,
    enabled,
    queryFn: () => apiFetch<ScheduledReportRow[]>("/reports/schedules"),
  });
}

export function useReportBranding(enabled = true) {
  return useQuery({
    queryKey: reportCenterKeys.branding,
    enabled,
    queryFn: () => apiFetch<WorkspaceBranding>("/reports/branding"),
  });
}

export function useEntityAttachments(
  entityType: string,
  entityId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: reportCenterKeys.attachments(entityType, entityId),
    enabled: enabled && Boolean(entityType && entityId),
    queryFn: () =>
      apiFetch<AttachmentRow[]>(
        `/attachments?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`,
      ),
  });
}

export function useCreateExportJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      reportDefinitionKey: string;
      format: string;
      parameters?: Record<string, string>;
    }) =>
      apiFetch<{ job: ExportJobRow; generatedReport: GeneratedReportRow }>("/reports/export-jobs", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["reports"] });
    },
  });
}

export function useCreateSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<ScheduledReportRow>("/reports/schedules", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: reportCenterKeys.schedules });
    },
  });
}

export function useToggleSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      apiFetch<ScheduledReportRow>(`/reports/schedules/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: reportCenterKeys.schedules });
    },
  });
}

export function useUpdateBranding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<WorkspaceBranding>) =>
      apiFetch<WorkspaceBranding>("/reports/branding", {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: reportCenterKeys.branding });
    },
  });
}

export function useDownloadGeneratedReport() {
  return useMutation({
    mutationFn: async ({ reportId, fileName }: { reportId: number; fileName: string }) => {
      const issued = await apiFetch<{ token: string; fileName: string }>(
        `/reports/generated/${reportId}/download`,
      );
      const name = issued.fileName || fileName;
      await downloadWithAuth(
        `/api/reports/generated/download/stream?token=${encodeURIComponent(issued.token)}`,
        name,
      );
    },
  });
}

export function useDownloadAttachment() {
  return useMutation({
    mutationFn: async ({ attachmentId, fileName }: { attachmentId: number; fileName: string }) => {
      const issued = await apiFetch<{ token: string; downloadUrl?: string }>(
        `/attachments/${attachmentId}/download`,
      );
      if (issued.downloadUrl?.startsWith("http")) {
        throw new Error("Direct object URLs are not permitted; use token stream only");
      }
      await downloadWithAuth(
        `/api/attachments/download/stream?token=${encodeURIComponent(issued.token)}`,
        fileName,
      );
    },
  });
}

export function useArchiveAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (attachmentId: number) =>
      apiFetch(`/attachments/${attachmentId}/archive`, { method: "POST" }),
    onSuccess: (_data, _id, _ctx) => {
      void qc.invalidateQueries({ queryKey: ["attachments"] });
    },
  });
}
