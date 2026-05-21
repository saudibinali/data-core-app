/**
 * P23-A — Platform Operations Center (governance read model + alerts)
 */
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Overview = {
  generatedAt: string;
  workspaces: {
    total: number;
    active: number;
    suspended: number;
    locked: number;
    archived: number;
    pendingActivation: number;
  };
  moduleSettings: { enabledWorkspaceModuleRows: number };
  support: { activeScopedSessions: number };
  recentLifecycleEvents: Array<{
    id: number;
    workspaceId: number;
    action: string;
    previousStatus: string;
    newStatus: string;
    reason: string;
    createdAt: string;
  }>;
  governanceAlerts: Array<{
    id: number;
    workspaceId: number | null;
    action: string;
    scope: string;
    createdAt: string;
  }>;
};

export default function SuperAdminPlatformOpsPage() {
  const q = useQuery({
    queryKey: ["/platform/governance/ops/overview"],
    queryFn: () => apiClient.get<Overview>("/api/platform/governance/ops/overview").then((r) => r.data),
    refetchInterval: 60_000,
  });

  if (q.isLoading) {
    return (
      <div className="p-6 space-y-4 max-w-6xl mx-auto">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (q.isError) {
    return (
      <div className="p-6 max-w-6xl mx-auto text-destructive">
        Failed to load platform operations overview.
      </div>
    );
  }

  const d = q.data!;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Platform Operations Center</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Workspace inventory, lifecycle signals, module governance footprint, and support session posture (P23-A).
        </p>
        <p className="text-xs text-muted-foreground mt-2">Generated {d.generatedAt}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Workspaces</CardTitle>
            <CardDescription>Status distribution</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span>Total</span>
              <Badge variant="secondary">{d.workspaces.total}</Badge>
            </div>
            <div className="flex justify-between">
              <span>Active</span>
              <span>{d.workspaces.active}</span>
            </div>
            <div className="flex justify-between">
              <span>Suspended</span>
              <span>{d.workspaces.suspended}</span>
            </div>
            <div className="flex justify-between">
              <span>Locked</span>
              <span>{d.workspaces.locked}</span>
            </div>
            <div className="flex justify-between">
              <span>Archived (disabled)</span>
              <span>{d.workspaces.archived}</span>
            </div>
            <div className="flex justify-between">
              <span>Pending activation</span>
              <span>{d.workspaces.pendingActivation}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Modules</CardTitle>
            <CardDescription>Workspace module settings</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{d.moduleSettings.enabledWorkspaceModuleRows}</p>
            <p className="text-xs text-muted-foreground mt-2">Rows with enabled=true (non-core toggles)</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Support</CardTitle>
            <CardDescription>Scoped impersonation sessions</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{d.support.activeScopedSessions}</p>
            <p className="text-xs text-muted-foreground mt-2">Active sessions not past expiry</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Governance</CardTitle>
            <CardDescription>Recent high-signal events</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{d.governanceAlerts.length}</p>
            <p className="text-xs text-muted-foreground mt-2">Latest governance alerts (windowed)</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent lifecycle events</CardTitle>
          <CardDescription>Non-destructive workspace status transitions</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Workspace</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>From → To</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.recentLifecycleEvents.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground text-sm">
                    No lifecycle events recorded yet.
                  </TableCell>
                </TableRow>
              ) : (
                d.recentLifecycleEvents.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>{e.workspaceId}</TableCell>
                    <TableCell>{e.action}</TableCell>
                    <TableCell className="text-xs">
                      {e.previousStatus} → {e.newStatus}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{String(e.createdAt)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Governance alerts</CardTitle>
          <CardDescription>Support, module toggles, finance hook failures</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Workspace</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.governanceAlerts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground text-sm">
                    No governance alerts in the current window.
                  </TableCell>
                </TableRow>
              ) : (
                d.governanceAlerts.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>{e.workspaceId ?? "—"}</TableCell>
                    <TableCell>{e.scope}</TableCell>
                    <TableCell className="text-xs">{e.action}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{String(e.createdAt)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
