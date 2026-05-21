/**
 * @file   components/governance/governance-error-state.tsx
 * @phase  P12-A - Governance Dashboard Shell & Navigation Foundations
 *
 * Standard error state for governance console pages.
 * Used when a governance API query returns an error.
 */

import { AlertTriangle } from "lucide-react";

interface GovernanceErrorStateProps {
  message?: string;
}

export function GovernanceErrorState({
  message = "Could not load governance data. The API may be unavailable or the governance stack may not be fully initialised.",
}: GovernanceErrorStateProps) {
  return (
    <div
      data-testid="governance-error-state"
      className="flex items-start gap-3 px-4 py-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20 text-sm text-red-800 dark:text-red-300"
    >
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
      <div>
        <p className="font-medium">Unable to load governance data</p>
        <p className="mt-0.5 text-red-700 dark:text-red-400">{message}</p>
      </div>
    </div>
  );
}
