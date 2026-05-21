/**
 * @phase P17-F - Platform Users console summary cards
 */

import type { PlatformUsersConsoleSummary } from "@/lib/platform-users-console-hooks";

function Card({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <div className="border border-border rounded-xl p-4 bg-card" data-testid={testId}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}

export function PlatformUsersSummaryCards({
  summary,
  isLoading,
}: {
  summary?: PlatformUsersConsoleSummary;
  isLoading: boolean;
}) {
  if (isLoading && !summary) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="platform-users-summary-cards">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (!summary) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="platform-users-summary-cards">
      <Card label="Total platform users" value={summary.totalPlatformUsers} testId="summary-total-users" />
      <Card label="Active" value={summary.active} testId="summary-active" />
      <Card label="Invited" value={summary.invited} testId="summary-invited" />
      <Card label="Suspended / Disabled" value={summary.suspendedDisabled} testId="summary-suspended-disabled" />
      <Card label="Protected users" value={summary.protectedUsers} testId="summary-protected" />
      <Card label="Custom overrides" value={summary.usersWithCustomOverrides} testId="summary-custom-overrides" />
      <Card label="Pending invitations" value={summary.pendingInvitations} testId="summary-pending-invitations" />
      <Card label="High risk users" value={summary.highRiskUsers} testId="summary-high-risk" />
    </div>
  );
}
