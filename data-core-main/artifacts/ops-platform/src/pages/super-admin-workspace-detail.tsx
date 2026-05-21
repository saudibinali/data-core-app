import { useState } from "react";
import { Link, useParams } from "wouter";
import { useTranslation } from "react-i18next";
import {
  useGetWorkspace,
  useGetWorkspaceStats,
  useGetWorkspaceUsers,
  useUpdateWorkspace,
  useResetUserPassword,
  getGetWorkspaceQueryKey,
} from "@workspace/api-client-react";
import {
  ArrowLeft, Building2, Users, Ticket, Layers, CheckCircle2,
  PauseCircle, XCircle, KeyRound, MoreHorizontal, Play, Pause,
  Ban, Eye, EyeOff, Pencil, Save, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";

type WorkspaceStatus = "active" | "suspended" | "disabled";

function ResetPasswordDialog({
  open, onOpenChange, user,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  user: { id: number; fullName: string; email?: string | null } | null;
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const resetPassword = useResetUserPassword();
  const { toast } = useToast();

  const handleReset = () => {
    if (!user || password.length < 8) return;
    resetPassword.mutate(
      { data: { userId: user.id, password } },
      {
        onSuccess: () => {
          toast({ title: t("password_reset"), description: t("password_reset_desc", { name: user.fullName }) });
          setPassword("");
          onOpenChange(false);
        },
        onError: (err: any) => {
          toast({ title: t("error"), description: err?.message, variant: "destructive" });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("reset_password")}</DialogTitle>
          <DialogDescription>
            {t("set_new_password", { name: user?.fullName })} ({user?.email})
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="new-pw">{t("new_password_placeholder")}</Label>
            <div className="relative">
              <Input
                id="new-pw"
                type={showPw ? "text" : "password"}
                placeholder={t("min_8_chars")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {password && password.length < 8 && (
              <p className="text-xs text-destructive">{t("password_too_short_desc")}</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
          <Button onClick={handleReset} disabled={password.length < 8 || resetPassword.isPending}>
            {resetPassword.isPending ? t("saving") : t("reset_password")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function SuperAdminWorkspaceDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const workspaceId = parseInt(id ?? "", 10);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: workspace, isLoading } = useGetWorkspace(workspaceId);
  const { data: stats } = useGetWorkspaceStats(workspaceId);
  const { data: users } = useGetWorkspaceUsers(workspaceId);
  const updateWorkspace = useUpdateWorkspace();

  const [resetTarget, setResetTarget] = useState<{ id: number; fullName: string; email: string | null | undefined } | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", logoUrl: "", primaryColor: "" });

  const statusConfig: Record<WorkspaceStatus, { label: string; icon: React.ElementType; className: string }> = {
    active: { label: t("ws_active"), icon: CheckCircle2, className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400" },
    suspended: { label: t("ws_suspended"), icon: PauseCircle, className: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400" },
    disabled: { label: t("ws_disabled"), icon: XCircle, className: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400" },
  };

  const startEdit = () => {
    setEditForm({
      name: workspace?.name ?? "",
      logoUrl: workspace?.logoUrl ?? "",
      primaryColor: workspace?.primaryColor ?? "#3b82f6",
    });
    setEditing(true);
  };

  const saveEdit = () => {
    updateWorkspace.mutate(
      { id: workspaceId, data: { name: editForm.name || undefined, logoUrl: editForm.logoUrl || null, primaryColor: editForm.primaryColor || null } },
      {
        onSuccess: () => {
          toast({ title: t("workspace_updated") });
          queryClient.invalidateQueries({ queryKey: getGetWorkspaceQueryKey(workspaceId) });
          setEditing(false);
        },
        onError: (err: any) => {
          toast({ title: t("error"), description: err?.message, variant: "destructive" });
        },
      }
    );
  };

  const handleStatusChange = (status: WorkspaceStatus) => {
    updateWorkspace.mutate(
      { id: workspaceId, data: { status } },
      {
        onSuccess: () => {
          toast({ title: t("status_updated") });
          queryClient.invalidateQueries({ queryKey: getGetWorkspaceQueryKey(workspaceId) });
        },
        onError: (err: any) => {
          toast({ title: t("error"), description: err?.message, variant: "destructive" });
        },
      }
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/super-admin/workspaces"><ArrowLeft className="w-4 h-4 mr-1" /> {t("back")}</Link>
        </Button>
        <p className="text-muted-foreground">{t("workspace_not_found")}</p>
      </div>
    );
  }

  const status = workspace.status as WorkspaceStatus;
  const cfg = statusConfig[status] ?? statusConfig.active;
  const StatusIcon = cfg.icon;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/super-admin/workspaces"><ArrowLeft className="w-4 h-4 mr-1" /> {t("workspaces_list")}</Link>
        </Button>
      </div>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: (workspace.primaryColor ?? "#3b82f6") + "22" }}
          >
            {workspace.logoUrl ? (
              <img src={workspace.logoUrl} alt={workspace.name} className="w-10 h-10 rounded-lg object-cover" />
            ) : (
              <Building2 className="w-7 h-7" style={{ color: workspace.primaryColor ?? "#3b82f6" }} />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight">{workspace.name}</h1>
              <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${cfg.className}`}>
                <StatusIcon className="w-3 h-3" />
                {cfg.label}
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {workspace.slug} · {format(new Date(workspace.createdAt), "MMM d, yyyy")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={startEdit}>
            <Pencil className="w-3.5 h-3.5 mr-1.5" /> {t("edit")}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {status !== "active" && (
                <DropdownMenuItem onClick={() => handleStatusChange("active")}>
                  <Play className="w-3.5 h-3.5 mr-2 text-emerald-600" /> {t("ws_activate")}
                </DropdownMenuItem>
              )}
              {status !== "suspended" && (
                <DropdownMenuItem onClick={() => handleStatusChange("suspended")}>
                  <Pause className="w-3.5 h-3.5 mr-2 text-amber-600" /> {t("ws_suspend")}
                </DropdownMenuItem>
              )}
              {status !== "disabled" && (
                <DropdownMenuItem onClick={() => handleStatusChange("disabled")}>
                  <Ban className="w-3.5 h-3.5 mr-2 text-red-600" /> {t("ws_disable")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {editing && (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="text-base">{t("edit_workspace")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t("company_name")}</Label>
              <Input value={editForm.name} onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>{t("logo_url_optional")}</Label>
                <Input value={editForm.logoUrl} onChange={(e) => setEditForm((p) => ({ ...p, logoUrl: e.target.value }))} placeholder="https://..." />
              </div>
              <div className="space-y-1.5">
                <Label>{t("brand_color")}</Label>
                <div className="flex items-center gap-2">
                  <input type="color" value={editForm.primaryColor} onChange={(e) => setEditForm((p) => ({ ...p, primaryColor: e.target.value }))} className="w-10 h-9 rounded border border-input p-1" />
                  <Input value={editForm.primaryColor} onChange={(e) => setEditForm((p) => ({ ...p, primaryColor: e.target.value }))} className="font-mono" />
                </div>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
                <X className="w-3.5 h-3.5 mr-1" /> {t("cancel")}
              </Button>
              <Button size="sm" onClick={saveEdit} disabled={updateWorkspace.isPending}>
                <Save className="w-3.5 h-3.5 mr-1" /> {t("save_changes")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: t("users"), value: stats?.userCount, icon: Users, color: "text-violet-600" },
          { label: t("tickets"), value: stats?.ticketCount, icon: Ticket, color: "text-orange-600" },
          { label: t("open_tickets"), value: stats?.openTicketCount, icon: Ticket, color: "text-blue-600" },
          { label: t("departments"), value: stats?.departmentCount, icon: Layers, color: "text-emerald-600" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">{s.label}</p>
                  <p className="text-2xl font-bold mt-1">{s.value ?? "-"}</p>
                </div>
                <s.icon className={`w-5 h-5 ${s.color}`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("workspace_users_title")}</CardTitle>
          <CardDescription>
            {users?.length ?? 0} {t("users")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!users ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : users.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">{t("no_users_in_workspace")}</p>
          ) : (
            <div className="space-y-1">
              {users.map((u) => (
                <div key={u.id} className="flex items-center gap-3 px-2 py-2.5 rounded-md hover:bg-muted transition-colors">
                  <img
                    src={u.avatarUrl ?? `https://api.dicebear.com/7.x/initials/svg?seed=${u.fullName}`}
                    alt={u.fullName}
                    className="w-8 h-8 rounded-full"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{u.fullName}</p>
                    <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                  </div>
                  <Badge variant="outline" className="text-xs capitalize shrink-0">{u.role}</Badge>
                  <Badge variant="outline" className="text-xs capitalize shrink-0">{u.status}</Badge>
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => setResetTarget({ id: u.id, fullName: u.fullName, email: u.email })}
                    title={t("reset_password")}
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ResetPasswordDialog
        open={!!resetTarget}
        onOpenChange={(v) => !v && setResetTarget(null)}
        user={resetTarget}
      />
    </div>
  );
}
