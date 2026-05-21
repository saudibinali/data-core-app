/**
 * @phase P17-E - Invitation & Activation section (platform user detail)
 */

import React, { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Copy, Check } from "lucide-react";
import { useAppAuth } from "@/lib/auth";
import { hasPlatformPermissionClient } from "@/lib/platform-access";
import {
  ACTIVATION_LINK_ONCE_NOTICE,
  PLATFORM_INVITATION_SAFETY_CONTRACT,
} from "@/lib/platform-user-invitation-config";
import {
  usePlatformUserInvitations,
  useCreatePlatformInvitation,
  useResendPlatformInvitation,
  useRevokePlatformInvitation,
} from "@/lib/platform-user-invitations-hooks";
import type { PlatformUserProfile } from "@/lib/platform-users-hooks";
import { isPolicyProtectedUser } from "@/lib/platform-admin-protection-config";

(function () {
  for (const [k, v] of Object.entries(PLATFORM_INVITATION_SAFETY_CONTRACT)) {
    if (!v) throw new Error(`PLATFORM_INVITATION_SAFETY_CONTRACT violated: ${k}`);
  }
})();

function cn(...cls: (string | false | null | undefined)[]) {
  return cls.filter(Boolean).join(" ");
}

export function InvitationActivationSection({ user }: { user: PlatformUserProfile }) {
  const { user: authUser } = useAppAuth();
  const canRead = hasPlatformPermissionClient(authUser ?? {}, "platform.invitations.read");
  const canCreate = hasPlatformPermissionClient(authUser ?? {}, "platform.invitations.create");
  const canRevoke = hasPlatformPermissionClient(authUser ?? {}, "platform.invitations.revoke");

  const { data: invitations, isLoading } = usePlatformUserInvitations(user.id, canRead);
  const createMutation = useCreatePlatformInvitation(user.id);
  const resendMutation = useResendPlatformInvitation(user.id);
  const revokeMutation = useRevokePlatformInvitation(user.id);

  const [activationUrl, setActivationUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [revokeId, setRevokeId] = useState<number | null>(null);

  const protectedUser = isPolicyProtectedUser(user);
  const pending = invitations?.find((i) => i.status === "pending");
  const latest = invitations?.[0];

  if (!canRead) return null;

  async function showLinkFrom(
    fn: () => Promise<{ activationUrl: string }>,
  ) {
    setError(null);
    setCopied(false);
    try {
      const result = await fn();
      setActivationUrl(result.activationUrl);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Operation failed");
      setActivationUrl(null);
    }
  }

  async function handleCopy() {
    if (!activationUrl) return;
    await navigator.clipboard.writeText(activationUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mt-4 pt-4 border-t border-border space-y-3" data-testid="invitation-activation-section">
      <div>
        <h4 className="text-sm font-semibold">Invitation &amp; Activation</h4>
        <p className="text-xs text-muted-foreground mt-0.5">
          Secure activation links — no email is sent from this console.
        </p>
      </div>

      {isLoading && <p className="text-xs text-muted-foreground">Loading invitations...</p>}

      {latest && (
        <dl className="grid grid-cols-2 gap-2 text-xs" data-testid="invitation-status-details">
          <div>
            <dt className="text-muted-foreground">Status</dt>
            <dd className="font-medium">{latest.status}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Expires</dt>
            <dd>{formatDistanceToNow(new Date(latest.expiresAt), { addSuffix: true })}</dd>
          </div>
          {latest.acceptedAt && (
            <div>
              <dt className="text-muted-foreground">Accepted</dt>
              <dd>{new Date(latest.acceptedAt).toLocaleString()}</dd>
            </div>
          )}
          {latest.revokedAt && (
            <div className="col-span-2">
              <dt className="text-muted-foreground">Revoked</dt>
              <dd>{latest.revokeReason ?? "—"}</dd>
            </div>
          )}
        </dl>
      )}

      {!latest && !isLoading && (
        <p className="text-xs text-muted-foreground">No invitations yet.</p>
      )}

      {error && (
        <p className="text-xs text-destructive" data-testid="invitation-error">
          {error}
        </p>
      )}

      {activationUrl && (
        <div
          className="p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 space-y-2"
          data-testid="activation-url-once-dialog"
        >
          <p className="text-xs font-medium text-amber-900 dark:text-amber-200">{ACTIVATION_LINK_ONCE_NOTICE}</p>
          <code className="block text-[10px] break-all p-2 bg-background rounded border">{activationUrl}</code>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs border rounded hover:bg-accent"
            data-testid="copy-activation-url"
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={() => setActivationUrl(null)}
            className="block text-xs text-muted-foreground underline"
          >
            Dismiss (link will not be shown again)
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {canCreate && user.status === "invited" && !protectedUser && (
          <>
            <button
              type="button"
              disabled={createMutation.isPending}
              onClick={() => showLinkFrom(() => createMutation.mutateAsync())}
              className="px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
              data-testid="create-invitation-btn"
            >
              Create Invitation
            </button>
            <button
              type="button"
              disabled={resendMutation.isPending}
              onClick={() => showLinkFrom(() => resendMutation.mutateAsync())}
              className="px-3 py-1.5 text-xs rounded-lg border border-input hover:bg-accent disabled:opacity-50"
              data-testid="resend-invitation-btn"
            >
              Resend Invitation
            </button>
          </>
        )}
        {canRevoke && pending && !protectedUser && (
          <button
            type="button"
            onClick={() => setRevokeId(pending.id)}
            className="px-3 py-1.5 text-xs rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300"
            data-testid="revoke-invitation-btn"
          >
            Revoke Invitation
          </button>
        )}
      </div>

      {protectedUser && (
        <p className="text-xs text-muted-foreground">
          Protected platform administrators cannot receive new invitations unless policy allows.
        </p>
      )}

      {revokeId !== null && (
        <div className="p-3 border rounded-lg space-y-2" data-testid="revoke-invitation-form">
          <label className="block text-xs font-medium">Revoke reason (min 10 chars)</label>
          <textarea
            value={revokeReason}
            onChange={(e) => setRevokeReason(e.target.value)}
            rows={2}
            className="w-full px-2 py-1 border rounded text-xs"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setRevokeId(null)}
              className="px-2 py-1 text-xs border rounded"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={revokeMutation.isPending || revokeReason.trim().length < 10}
              onClick={async () => {
                try {
                  await revokeMutation.mutateAsync({ invitationId: revokeId, reason: revokeReason.trim() });
                  setRevokeId(null);
                  setRevokeReason("");
                } catch (e: unknown) {
                  setError(e instanceof Error ? e.message : "Revoke failed");
                }
              }}
              className="px-2 py-1 text-xs bg-rose-600 text-white rounded disabled:opacity-50"
            >
              Confirm Revoke
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
