import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useListEventLogs, useListEventRegistry } from "@workspace/api-client-react";
import {
  Zap, CheckCircle2, XCircle, Clock, Loader2,
  ChevronLeft, ChevronRight, Filter, RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDistanceToNow } from "date-fns";

const statusConfig = {
  completed: { icon: CheckCircle2, className: "text-emerald-600", badge: "default" },
  failed:    { icon: XCircle,      className: "text-red-600",     badge: "destructive" },
  processing:{ icon: Loader2,      className: "text-amber-600",   badge: "secondary" },
  pending:   { icon: Clock,        className: "text-slate-500",   badge: "outline" },
} as const;

const MODULE_COLORS: Record<string, string> = {
  tickets:     "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  users:       "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  approvals:   "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  departments: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  groups:      "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300",
  hr:          "bg-pink-100 text-pink-800 dark:bg-pink-950 dark:text-pink-300",
  calendar:    "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300",
  system:      "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300",
};

function StatusBadge({ status }: { status: string }) {
  const cfg = statusConfig[status as keyof typeof statusConfig];
  const Icon = cfg?.icon ?? Clock;
  return (
    <Badge variant={(cfg?.badge as "default" | "destructive" | "secondary" | "outline") ?? "outline"} className="gap-1 text-xs capitalize">
      <Icon className={`w-3 h-3 ${cfg?.className ?? ""}`} />
      {status}
    </Badge>
  );
}

function ModuleBadge({ module }: { module: string }) {
  const color = MODULE_COLORS[module] ?? MODULE_COLORS["system"]!;
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${color}`}>
      {module}
    </span>
  );
}

const ALL_VALUE = "__all__";

export default function SuperAdminEvents() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [moduleFilter, setModuleFilter] = useState<string>(ALL_VALUE);
  const [statusFilter, setStatusFilter] = useState<string>(ALL_VALUE);
  const [eventFilter, setEventFilter] = useState<string>(ALL_VALUE);
  const limit = 25;

  const { data: registry } = useListEventRegistry();
  const { data, isLoading, refetch, isFetching } = useListEventLogs(
    {
      page,
      limit,
      ...(moduleFilter !== ALL_VALUE && { module: moduleFilter }),
      ...(statusFilter !== ALL_VALUE && { status: statusFilter as "pending" | "processing" | "completed" | "failed" }),
      ...(eventFilter !== ALL_VALUE && { eventName: eventFilter }),
    },
    { query: { queryKey: ["event-logs", page, moduleFilter, statusFilter, eventFilter] } },
  );

  const totalPages = data ? Math.ceil(data.total / limit) : 1;

  const modules = registry
    ? [...new Set(registry.map((e) => e.module))].sort()
    : [];

  const allStatuses = ["pending", "processing", "completed", "failed"];

  function resetFilters() {
    setModuleFilter(ALL_VALUE);
    setStatusFilter(ALL_VALUE);
    setEventFilter(ALL_VALUE);
    setPage(1);
  }

  const hasFilters = moduleFilter !== ALL_VALUE || statusFilter !== ALL_VALUE || eventFilter !== ALL_VALUE;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Zap className="w-6 h-6 text-primary" />
            Event Log
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Real-time audit trail of all platform events across workspaces
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Registry stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Registered Events", value: registry?.length ?? "–" },
          { label: "Total Logged",      value: data?.total ?? "–" },
          { label: "This Page",         value: data?.data.length ?? "–" },
          { label: "Page",              value: data ? `${page} / ${totalPages}` : "–" },
        ].map((stat) => (
          <Card key={stat.label} className="py-4">
            <CardContent className="px-4 pb-0 pt-0">
              <p className="text-xs text-muted-foreground">{stat.label}</p>
              <p className="text-2xl font-bold mt-0.5">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Filter className="w-4 h-4" /> Filters
            {hasFilters && (
              <Button variant="ghost" size="sm" className="ml-auto h-6 text-xs" onClick={resetFilters}>
                Clear
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            {/* Module */}
            <Select value={moduleFilter} onValueChange={(v) => { setModuleFilter(v); setPage(1); }}>
              <SelectTrigger className="w-40 h-8 text-xs">
                <SelectValue placeholder="All modules" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>All modules</SelectItem>
                {modules.map((m) => (
                  <SelectItem key={m} value={m} className="capitalize">{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Status */}
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="w-36 h-8 text-xs">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>All statuses</SelectItem>
                {allStatuses.map((s) => (
                  <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Event name */}
            <Select value={eventFilter} onValueChange={(v) => { setEventFilter(v); setPage(1); }}>
              <SelectTrigger className="w-52 h-8 text-xs">
                <SelectValue placeholder="All event types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>All event types</SelectItem>
                {(registry ?? []).map((e) => (
                  <SelectItem key={e.eventName} value={e.eventName}>{e.eventName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Event log table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Event History</CardTitle>
          <CardDescription>Most recent events first</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : (data?.data ?? []).length === 0 ? (
            <div className="py-16 text-center">
              <Zap className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">No events logged yet</p>
              <p className="text-muted-foreground text-xs mt-1">Events appear here as actions are performed across the platform</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {data!.data.map((log) => {
                const cfg = statusConfig[log.status as keyof typeof statusConfig];
                const StatusIcon = cfg?.icon ?? Clock;
                return (
                  <div key={log.id} className="flex items-start gap-4 px-6 py-4 hover:bg-muted/30 transition-colors">
                    <div className={`mt-0.5 shrink-0 ${cfg?.className ?? "text-slate-400"}`}>
                      <StatusIcon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-mono font-medium">{log.eventName}</span>
                        <ModuleBadge module={log.module} />
                        <StatusBadge status={log.status} />
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                        {log.triggeredByName && (
                          <span>by <span className="font-medium text-foreground">{log.triggeredByName}</span></span>
                        )}
                        {log.error && (
                          <span className="text-red-500 truncate max-w-xs" title={log.error}>
                            ⚠ {log.error}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground shrink-0 text-right">
                      <p>{formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}</p>
                      {log.processedAt && (
                        <p className="text-[10px] mt-0.5 opacity-60">
                          processed {formatDistanceToNow(new Date(log.processedAt), { addSuffix: true })}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-border">
            <p className="text-xs text-muted-foreground">
              {data?.total ?? 0} total events
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="h-8 w-8 p-0"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-xs min-w-[4rem] text-center">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="h-8 w-8 p-0"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Event Registry */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Event Registry</CardTitle>
          <CardDescription>All {registry?.length ?? 0} registered event types</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {!registry ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {registry.map((entry) => (
                <div key={entry.id} className="flex items-center gap-4 px-6 py-3 hover:bg-muted/20 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono">{entry.eventName}</span>
                      <ModuleBadge module={entry.module} />
                    </div>
                    {entry.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">{entry.description}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
