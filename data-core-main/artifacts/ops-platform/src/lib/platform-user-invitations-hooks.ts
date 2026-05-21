/**
 * @phase P17-E - Platform user invitation hooks
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PLATFORM_INVITATION_API } from "./platform-user-invitation-config";

function getAuthToken(): string | null {
  return localStorage.getItem("ops_access_token");
}

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token
    ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
    : { "Content-Type": "application/json" };
}

export interface PlatformInvitationView {
  id: number;
  platformUserId: number;
  email: string;
  status: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  revokedBy: number | null;
  revokeReason: string | null;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
}

export function usePlatformUserInvitations(userId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["platform", "users", userId, "invitations"],
    queryFn: async () => {
      const res = await fetch(PLATFORM_INVITATION_API.list(userId!), { headers: authHeaders() });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Failed to load invitations");
      }
      const data = await res.json() as { invitations: PlatformInvitationView[] };
      return data.invitations;
    },
    enabled: enabled && Boolean(userId),
  });
}

export function useCreatePlatformInvitation(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(PLATFORM_INVITATION_API.create(userId), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string; code?: string };
        throw new Error(body.error ?? "Failed to create invitation");
      }
      return res.json() as Promise<{
        activationToken: string;
        activationUrl: string;
        invitation: PlatformInvitationView;
      }>;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["platform", "users", userId, "invitations"] });
    },
  });
}

export function useResendPlatformInvitation(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(PLATFORM_INVITATION_API.resend(userId), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Failed to resend invitation");
      }
      return res.json() as Promise<{
        activationToken: string;
        activationUrl: string;
        invitation: PlatformInvitationView;
      }>;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["platform", "users", userId, "invitations"] });
    },
  });
}

export function useRevokePlatformInvitation(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ invitationId, reason }: { invitationId: number; reason: string }) => {
      const res = await fetch(PLATFORM_INVITATION_API.revoke(invitationId), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Failed to revoke invitation");
      }
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["platform", "users", userId, "invitations"] });
    },
  });
}
