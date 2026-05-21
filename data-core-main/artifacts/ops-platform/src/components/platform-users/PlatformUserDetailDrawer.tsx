/**
 * @phase P17-F - Platform user detail drawer with integrated tabs
 */

import React, { useState } from "react";
import { X } from "lucide-react";
import { useAppAuth } from "@/lib/auth";
import { canPerformPlatformAction } from "@/lib/platform-access";
import {
  PLATFORM_USER_DETAIL_TABS,
  type PlatformUserDetailTab,
} from "@/lib/platform-users-console-config";
import type { PlatformUserProfile } from "@/lib/platform-users-hooks";
import { CustomPermissionsSection } from "./CustomPermissionsSection";
import { InvitationActivationSection } from "./InvitationActivationSection";
import { PlatformUserProtectionTab } from "./PlatformUserProtectionTab";
import { PlatformUserAccessReviewTab } from "./PlatformUserAccessReviewTab";
import { PlatformUserAuditTab } from "./PlatformUserAuditTab";
import {
  isPolicyProtectedUser,
  PLATFORM_ADMIN_PROTECTION_NOTICE,
} from "@/lib/platform-admin-protection-config";
import { PLATFORM_USER_EMPTY_STATE } from "@/lib/platform-users-config";

export interface PlatformUserDetailDrawerProps {
  user: PlatformUserProfile;
  onClose: () => void;
  overviewContent: React.ReactNode;
}

function cn(...cls: (string | false | null | undefined)[]) {
  return cls.filter(Boolean).join(" ");
}

export function PlatformUserDetailDrawer({
  user,
  onClose,
  overviewContent,
}: PlatformUserDetailDrawerProps) {
  const [tab, setTab] = useState<PlatformUserDetailTab>("overview");
  const { user: authUser } = useAppAuth();
  const canEdit = canPerformPlatformAction(authUser ?? {}, "platform.user.update");

  return (
    <div
      className="fixed inset-0 sm:inset-y-0 sm:left-auto sm:right-0 z-50 w-full sm:max-w-xl bg-background border-l border-border shadow-xl flex flex-col"
      data-testid="platform-user-detail-drawer"
    >
      <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
        <div>
          <h2 className="font-semibold text-sm">{user.displayName}</h2>
          <p className="text-xs text-muted-foreground">{user.email ?? "No email"}</p>
        </div>
        <button type="button" onClick={onClose} className="p-1 rounded hover:bg-accent" aria-label="Close">
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav
        className="flex flex-wrap gap-1 px-4 py-2 border-b border-border shrink-0"
        data-testid="platform-user-detail-tabs"
      >
        {PLATFORM_USER_DETAIL_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "px-2.5 py-1 text-xs rounded-md transition-colors",
              tab === t.id ? "bg-primary text-primary-foreground" : "hover:bg-accent",
            )}
            data-testid={`detail-tab-${t.id}`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto p-4">
        {isPolicyProtectedUser(user) && tab !== "protection" && (
          <div
            className="mb-4 p-2 rounded border border-amber-200 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-900 dark:text-amber-200"
            data-testid="user-detail-protection-notice"
          >
            {PLATFORM_ADMIN_PROTECTION_NOTICE}
            {user.isRootOwner && (
              <p className="mt-1 text-violet-700 dark:text-violet-300">{PLATFORM_USER_EMPTY_STATE.protectedNotice}</p>
            )}
          </div>
        )}

        {tab === "overview" && (
          <div data-testid="user-overview-tab">{overviewContent}</div>
        )}
        {tab === "permissions" && (
          <div data-testid="user-permissions-tab">
            <CustomPermissionsSection user={user} />
          </div>
        )}
        {tab === "protection" && <PlatformUserProtectionTab user={user} />}
        {tab === "invitations" && <InvitationActivationSection user={user} />}
        {tab === "access-review" && <PlatformUserAccessReviewTab user={user} />}
        {tab === "audit" && <PlatformUserAuditTab user={user} />}
      </div>

      <div
        className="p-3 border-t border-border text-xs text-muted-foreground shrink-0"
        data-testid="detail-drawer-footer"
      >
        {canEdit && !user.isProtected && !user.isRootOwner
          ? "Use Overview tab for profile and lifecycle actions."
          : "Sensitive changes may require root owner approval."}
      </div>
    </div>
  );
}
