/**
 * @phase P16-E - Read-only workspace banner for tenant UI
 */

import { Lock } from "lucide-react";
import { useWorkspaceAccess } from "@/lib/workspace-access-context";
import { ENFORCEMENT_STATUS_LABELS } from "@/lib/workspace-access-enforcement-config";

export function WorkspaceReadOnlyBanner() {
  const { isReadOnly, access, isLoading } = useWorkspaceAccess();

  if (isLoading || !isReadOnly) {
    return null;
  }

  const statusLabel =
    ENFORCEMENT_STATUS_LABELS[access?.enforcementStatus ?? ""]?.label ??
    access?.enforcementStatus ??
    "Read-only";

  return (
    <div
      className="shrink-0 flex items-start gap-2 border-b border-amber-300/60 bg-amber-50 dark:bg-amber-950/40 px-4 py-2.5"
      data-testid="workspace-read-only-banner"
      role="status"
    >
      <Lock className="w-4 h-4 text-amber-700 dark:text-amber-300 shrink-0 mt-0.5" />
      <div className="text-xs text-amber-900 dark:text-amber-100 space-y-0.5">
        <p className="font-medium">
          Workspace is in read-only mode due to subscription status ({statusLabel}).
        </p>
        <p className="text-amber-800/90 dark:text-amber-200/90">
          You can view and search data. Create, edit, delete, submit, approve, upload, and run
          actions are disabled. Invoice viewing and PDF download remain available where permitted.
        </p>
        {access?.reason && (
          <p className="text-amber-700/80 dark:text-amber-300/80 italic">{access.reason}</p>
        )}
      </div>
    </div>
  );
}
