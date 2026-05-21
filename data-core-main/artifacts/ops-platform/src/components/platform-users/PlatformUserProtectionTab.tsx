/**
 * @phase P17-F - Protection tab (read-only policy visibility)
 */

import { PLATFORM_ADMIN_PROTECTION_NOTICE } from "@/lib/platform-admin-protection-config";
import { formatProtectionBlockedReason } from "@/lib/platform-admin-protection-config";
import { usePlatformUserConsole } from "@/lib/platform-users-console-hooks";
import type { PlatformUserProfile } from "@/lib/platform-users-hooks";

export function PlatformUserProtectionTab({ user }: { user: PlatformUserProfile }) {
  const { data, isLoading } = usePlatformUserConsole(user.id, true);

  return (
    <div className="space-y-4 text-sm" data-testid="user-protection-tab">
      <p className="text-xs text-muted-foreground">{PLATFORM_ADMIN_PROTECTION_NOTICE}</p>

      {isLoading && <p className="text-xs text-muted-foreground">Loading protection summary...</p>}

      {data && (
        <>
          <section data-testid="protection-reasons">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">Protection reasons</h4>
            {data.protectionSummary.protectionReasons.length === 0 ? (
              <p className="text-xs text-muted-foreground">No protection flags apply.</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {data.protectionSummary.protectionReasons.map((r: string) => (
                  <span key={r} className="text-[10px] px-1.5 py-0.5 rounded bg-muted font-mono">
                    {r}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section data-testid="policy-snapshot">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">Policy snapshot</h4>
            <dl className="grid grid-cols-2 gap-2 text-xs">
              {Object.entries(data.protectionSummary.policySnapshot).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="font-mono">{String(v)}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section data-testid="blocked-actions">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">Blocked actions</h4>
            {data.protectionSummary.blockedActions.length === 0 ? (
              <p className="text-xs text-muted-foreground">No blocked actions for this user under current policy.</p>
            ) : (
              <ul className="space-y-2">
                {data.protectionSummary.blockedActions.map((b: { action: string; blockedReason: string }) => (
                  <li key={b.action} className="p-2 rounded border border-border text-xs" data-testid="blocked-action-row">
                    <span className="font-medium">{b.action}</span>
                    <span className="block text-muted-foreground mt-0.5">
                      {formatProtectionBlockedReason(b.blockedReason)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
