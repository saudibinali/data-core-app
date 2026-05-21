/**
 * platform-users-hooks.ts
 *
 * @phase P14-A/P14-B - Platform Users hooks
 * @phase P17-A - Directory list filters, profile update
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  PLATFORM_USER_API_PATHS,
  type PlatformUserStatus,
  type InitialPlatformRoleCode,
} from "./platform-users-config";
import type { PlatformUserType } from "./platform-user-directory-config";
import { formatProtectionBlockedReason } from "./platform-admin-protection-config";

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
    const err = await res.json().catch(() => ({})) as { error?: string; code?: string; codes?: string[] };
    throw new Error(err.error ?? `POST ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string; code?: string; codes?: string[] };
    const message = err.code
      ? formatProtectionBlockedReason(err.code)
      : (err.error ?? `PATCH ${path} failed: ${res.status}`);
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export interface PlatformUserProfile {
  id: string;
  email: string | null;
  displayName: string;
  userType: PlatformUserType;
  roleCode: InitialPlatformRoleCode;
  status: PlatformUserStatus;
  jobTitle: string | null;
  department: string | null;
  phone: string | null;
  isRootOwner: boolean;
  isProtected: boolean;
  lastLoginAt: string | null;
  disabledAt?: string | null;
  disableReason?: string | null;
  reactivatedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformUsersListParams {
  search?: string;
  status?: string;
  userType?: string;
  page?: number;
  pageSize?: number;
}

export interface PlatformUsersData {
  users: PlatformUserProfile[];
  total: number;
  page?: number;
  pageSize?: number;
}

export interface PlatformUserData {
  user: PlatformUserProfile;
}

export interface CreatePlatformUserInput {
  email: string;
  displayName: string;
  userType?: PlatformUserType;
  roleCode?: string;
  jobTitle?: string;
  department?: string;
  phone?: string;
}

export interface UpdatePlatformUserProfileInput {
  userId: string;
  displayName?: string;
  jobTitle?: string | null;
  department?: string | null;
  phone?: string | null;
}

export interface UpdatePlatformUserStatusInput {
  userId: string;
  nextStatus: PlatformUserStatus;
  reason: string;
  confirmation: boolean;
}

export interface UpdatePlatformUserStatusResult {
  user: PlatformUserProfile;
  previousStatus: PlatformUserStatus;
  nextStatus: PlatformUserStatus;
}

export interface UpdatePlatformUserRoleInput {
  userId: string;
  roleCode: string;
  reason: string;
  confirmation: boolean;
}

export interface UpdatePlatformUserRoleResult {
  user: PlatformUserProfile;
  previousRoleCode: string | null;
  nextRoleCode: string;
}

export function usePlatformUsers(params?: PlatformUsersListParams) {
  return useQuery<PlatformUsersData>({
    queryKey: ["platform", "users", params ?? {}],
    queryFn: () => getJson<PlatformUsersData>(PLATFORM_USER_API_PATHS.list(params)),
    staleTime: 30_000,
  });
}

export function usePlatformUser(userId: string | null) {
  return useQuery<PlatformUserData>({
    queryKey: ["platform", "users", userId],
    queryFn: () => getJson<PlatformUserData>(PLATFORM_USER_API_PATHS.get(userId!)),
    enabled: userId !== null,
    staleTime: 30_000,
  });
}

export function useCreatePlatformUser() {
  const queryClient = useQueryClient();
  return useMutation<PlatformUserData, Error, CreatePlatformUserInput>({
    mutationFn: (input) =>
      postJson<PlatformUserData>(PLATFORM_USER_API_PATHS.create(), input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["platform", "users"] });
    },
  });
}

export function useUpdatePlatformUserProfile() {
  const queryClient = useQueryClient();
  return useMutation<PlatformUserData, Error, UpdatePlatformUserProfileInput>({
    mutationFn: ({ userId, ...body }) =>
      patchJson<PlatformUserData>(PLATFORM_USER_API_PATHS.update(userId), body),
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["platform", "users"] });
      void queryClient.invalidateQueries({ queryKey: ["platform", "users", variables.userId] });
    },
  });
}

export function useUpdatePlatformUserStatus() {
  const queryClient = useQueryClient();
  return useMutation<UpdatePlatformUserStatusResult, Error, UpdatePlatformUserStatusInput>({
    mutationFn: ({ userId, nextStatus, reason, confirmation }) =>
      patchJson<UpdatePlatformUserStatusResult>(
        PLATFORM_USER_API_PATHS.updateStatus(userId),
        { nextStatus, reason, confirmation },
      ),
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["platform", "users"] });
      void queryClient.invalidateQueries({ queryKey: ["platform", "users", variables.userId] });
    },
  });
}

export function useUpdatePlatformUserRole() {
  const queryClient = useQueryClient();
  return useMutation<UpdatePlatformUserRoleResult, Error, UpdatePlatformUserRoleInput>({
    mutationFn: ({ userId, roleCode, reason, confirmation }) =>
      patchJson<UpdatePlatformUserRoleResult>(
        PLATFORM_USER_API_PATHS.updateRole(userId),
        { roleCode, reason, confirmation },
      ),
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["platform", "users"] });
      void queryClient.invalidateQueries({ queryKey: ["platform", "users", variables.userId] });
    },
  });
}
