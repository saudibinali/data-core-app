/**
 * @phase P17-B - Hooks for custom platform permission assignment
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PLATFORM_PERMISSION_API_PATHS } from "./platform-permission-assignment-config";
import type { PlatformPermissionCode } from "./platform-permissions-config";

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

async function putJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "PUT", headers: authHeaders(), body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string; codes?: string[] };
    throw new Error(err.error ?? `PUT ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "PATCH", headers: authHeaders(), body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string; codes?: string[] };
    throw new Error(err.error ?? `PATCH ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function deleteJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "DELETE", headers: authHeaders(), body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string; codes?: string[] };
    throw new Error(err.error ?? `DELETE ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface PermissionCatalogEntry {
  code: PlatformPermissionCode;
  label: string;
  labelAr: string;
  description: string;
  group: string;
  riskLevel: string;
}

export interface UserPermissionsData {
  rolePermissions: PlatformPermissionCode[];
  grantedOverrides: PlatformPermissionCode[];
  deniedOverrides: PlatformPermissionCode[];
  effectivePermissions: PlatformPermissionCode[];
  restrictedByProtection: boolean;
  overrides: Array<{
    id: number;
    permissionCode: string;
    effect: "grant" | "deny";
    reason: string;
  }>;
}

export function usePlatformPermissionCatalog(enabled = true) {
  return useQuery({
    queryKey: ["platform", "permissions", "catalog"],
    queryFn: () =>
      getJson<{ permissions: PermissionCatalogEntry[]; groups: unknown[] }>(
        PLATFORM_PERMISSION_API_PATHS.catalog(),
      ),
    enabled,
    staleTime: 120_000,
  });
}

export function usePlatformUserPermissions(userId: string | null) {
  return useQuery<UserPermissionsData>({
    queryKey: ["platform", "users", userId, "permissions"],
    queryFn: () => getJson<UserPermissionsData>(PLATFORM_PERMISSION_API_PATHS.userPermissions(userId!)),
    enabled: userId !== null,
    staleTime: 15_000,
  });
}

export function useBulkUpdatePermissionOverrides(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      reason: string;
      overrides: Array<{ permissionCode: string; effect: "grant" | "deny" }>;
    }) => putJson(PLATFORM_PERMISSION_API_PATHS.bulkOverrides(userId), input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["platform", "users", userId, "permissions"] });
      void qc.invalidateQueries({ queryKey: ["platform", "me"] });
    },
  });
}

export function usePatchPermissionOverride(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { permissionCode: string; effect: "grant" | "deny"; reason: string }) =>
      patchJson(PLATFORM_PERMISSION_API_PATHS.singleOverride(userId, input.permissionCode), {
        effect: input.effect,
        reason: input.reason,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["platform", "users", userId, "permissions"] });
      void qc.invalidateQueries({ queryKey: ["platform", "me"] });
    },
  });
}

export function useClearPermissionOverride(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { permissionCode: string; reason: string }) =>
      deleteJson(PLATFORM_PERMISSION_API_PATHS.singleOverride(userId, input.permissionCode), {
        reason: input.reason,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["platform", "users", userId, "permissions"] });
      void qc.invalidateQueries({ queryKey: ["platform", "me"] });
    },
  });
}
