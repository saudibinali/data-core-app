import { useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import {
  useListWorkspaces,
  useUpdateWorkspace,
  useDeleteWorkspace,
  getListWorkspacesQueryKey,
} from "@workspace/api-client-react";
import {
  Building2, Plus, Search, MoreHorizontal, CheckCircle2,
  PauseCircle, XCircle, Users, Ticket, Layers, ExternalLink,
  Trash2, Play, Pause, Ban,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

type WorkspaceStatus = "active" | "suspended" | "disabled";

export default function SuperAdminWorkspaces() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<WorkspaceStatus | "all">("all");
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);

  const { data: workspaces, isLoading } = useListWorkspaces();
  const updateWorkspace = useUpdateWorkspace();
  const deleteWorkspace = useDeleteWorkspace();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const statusConfig: Record<WorkspaceStatus, { label: string; icon: React.ElementType; className: string }> = {
    active: { label: t("ws_active"), icon: CheckCircle2, className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400" },
    suspended: { label: t("ws_suspended"), icon: PauseCircle, className: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400" },
    disabled: { label: t("ws_disabled"), icon: XCircle, className: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400" },
  };

  const filtered = (workspaces ?? []).filter((w) => {
    const matchesSearch =
      w.name.toLowerCase().includes(search.toLowerCase()) ||
      w.slug.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === "all" || w.status === filter;
    return matchesSearch && matchesFilter;
  });

  const handleStatusChange = async (id: number, status: WorkspaceStatus) => {
    updateWorkspace.mutate(
      { id, data: { status } },
      {
        onSuccess: () => {
          toast({ title: t("status_updated") });
          queryClient.invalidateQueries({ queryKey: getListWorkspacesQueryKey() });
        },
        onError: (err: any) => {
          toast({ title: t("error"), description: err?.message, variant: "destructive" });
        },
      }
    );
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteWorkspace.mutate(
      { id: deleteTarget.id },
      {
        onSuccess: () => {
          toast({ title: t("workspace_deleted") });
          queryClient.invalidateQueries({ queryKey: getListWorkspacesQueryKey() });
          setDeleteTarget(null);
        },
        onError: (err: any) => {
          toast({ title: t("error"), description: err?.message, variant: "destructive" });
          setDeleteTarget(null);
        },
      }
    );
  };

  const filterCounts = {
    all: workspaces?.length ?? 0,
    active: workspaces?.filter((w) => w.status === "active").length ?? 0,
    suspended: workspaces?.filter((w) => w.status === "suspended").length ?? 0,
    disabled: workspaces?.filter((w) => w.status === "disabled").length ?? 0,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("workspaces_list")}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t("workspaces_list_desc")}</p>
        </div>
        <Button asChild>
          <Link href="/super-admin/workspaces/new">
            <Plus className="w-4 h-4 mr-1.5" /> {t("new_workspace")}
          </Link>
        </Button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={t("search_workspaces")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1">
          {(["all", "active", "suspended", "disabled"] as const).map((f) => (
            <Button
              key={f}
              variant={filter === f ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(f)}
              className="capitalize"
            >
              {f === "all" ? t("filter_all") : statusConfig[f as WorkspaceStatus]?.label ?? f} ({filterCounts[f]})
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 flex flex-col items-center gap-3">
            <Building2 className="w-10 h-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              {search || filter !== "all" ? t("no_match_filters") : t("no_workspaces_yet")}
            </p>
            {!search && filter === "all" && (
              <Button asChild size="sm">
                <Link href="/super-admin/workspaces/new">{t("create_first_workspace")}</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((ws) => {
            const status = ws.status as WorkspaceStatus;
            const cfg = statusConfig[status] ?? statusConfig.active;
            const StatusIcon = cfg.icon;
            return (
              <Card key={ws.id} className="hover:border-border/80 transition-colors">
                <CardContent className="py-4">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"
                      style={ws.primaryColor ? { backgroundColor: ws.primaryColor + "22" } : {}}>
                      {ws.logoUrl ? (
                        <img src={ws.logoUrl} alt={ws.name} className="w-7 h-7 rounded object-cover" />
                      ) : (
                        <Building2 className="w-5 h-5 text-primary" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link href={`/super-admin/workspaces/${ws.id}`}>
                          <span className="font-semibold hover:underline cursor-pointer">{ws.name}</span>
                        </Link>
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${cfg.className}`}>
                          <StatusIcon className="w-3 h-3" />
                          {cfg.label}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{ws.slug}</p>
                    </div>

                    <div className="hidden sm:flex items-center gap-6 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5" />
                        <span>{ws.userCount} {t("users")}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Ticket className="w-3.5 h-3.5" />
                        <span>{ws.ticketCount} {t("tickets")}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5" />
                        <span>{ws.departmentCount} {t("departments")}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/super-admin/workspaces/${ws.id}`}>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </Link>
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem asChild>
                            <Link href={`/super-admin/workspaces/${ws.id}`}>{t("view_details")}</Link>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {status !== "active" && (
                            <DropdownMenuItem onClick={() => handleStatusChange(ws.id, "active")}>
                              <Play className="w-3.5 h-3.5 mr-2 text-emerald-600" />
                              {t("ws_activate")}
                            </DropdownMenuItem>
                          )}
                          {status !== "suspended" && (
                            <DropdownMenuItem onClick={() => handleStatusChange(ws.id, "suspended")}>
                              <Pause className="w-3.5 h-3.5 mr-2 text-amber-600" />
                              {t("ws_suspend")}
                            </DropdownMenuItem>
                          )}
                          {status !== "disabled" && (
                            <DropdownMenuItem onClick={() => handleStatusChange(ws.id, "disabled")}>
                              <Ban className="w-3.5 h-3.5 mr-2 text-red-600" />
                              {t("ws_disable")}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeleteTarget({ id: ws.id, name: ws.name })}
                          >
                            <Trash2 className="w-3.5 h-3.5 mr-2" />
                            {t("ws_delete_permanently")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("delete_workspace_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("delete_workspace_desc", { name: deleteTarget?.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("ws_delete_permanently")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
