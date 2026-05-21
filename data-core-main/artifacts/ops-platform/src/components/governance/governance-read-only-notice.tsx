/**
 * @file   components/governance/governance-read-only-notice.tsx
 * @phase  P12-A - Governance Dashboard Shell & Navigation Foundations
 *
 * Persistent read-only notice shown on every governance page.
 * Communicates to operators that this area is advisory only.
 */

import { Eye } from "lucide-react";

export function GovernanceReadOnlyNotice() {
  return (
    <div
      data-testid="governance-read-only-notice"
      className="flex items-start gap-2.5 px-4 py-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 text-sm text-blue-800 dark:text-blue-300"
    >
      <Eye className="w-4 h-4 shrink-0 mt-0.5" />
      <span>
        <strong>Read-only governance review area.</strong>{" "}
        This console displays audit intelligence, policy evaluation, and compliance analytics
        for review purposes only. No enforcement, mutation, or export actions are available here.
      </span>
    </div>
  );
}
