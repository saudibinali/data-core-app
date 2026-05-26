import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useListDepartments, useCreateDepartment, useUpdateDepartment, useDeleteDepartment, useListUsers, useGetMe } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Plus, Users, Building2, UserCheck, Pencil, Trash2, Info, ArrowRight } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { useOrgCutover } from "@/lib/org-cutover-flags";

// ─── Create / Edit Dialog ────────────────────────────────────────────────────

function DepartmentFormDialog({
  open, onClose, existing,
}: {
  open: boolean;
  onClose: () => void;
  existing?: { id: number; name: string; description?: string | null; managerId?: number | null };
}) {
  const { t } = useTranslation();
  const isEdit = !!existing;
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [managerId, setManagerId] = useState<string>(existing?.managerId ? String(existing.managerId) : "");
  const { data: users } = useListUsers();
  const createDepartment = useCreateDepartment();
  const updateDepartment = useUpdateDepartment();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      name,
      description: description || null,
      managerId: managerId ? parseInt(managerId) : null,
    };

    if (isEdit) {
      updateDepartment.mutate({ id: existing!.id, data: payload as any }, {
        onSuccess: () => {
          toast({ title: t("dept_updated") });
          queryClient.invalidateQueries({ queryKey: ["/api/departments"] });
          onClose();
        },
        onError: (err: any) => toast({ title: t("error"), description: err?.response?.data?.error, variant: "destructive" }),
      });
    } else {
      createDepartment.mutate({ data: payload as any }, {
        onSuccess: () => {
          toast({ title: t("dept_created") });
          queryClient.invalidateQueries({ queryKey: ["/api/departments"] });
          onClose();
        },
        onError: (err: any) => toast({ title: t("error"), description: err?.response?.data?.error, variant: "destructive" }),
      });
    }
  };

  const activeUsers = (users ?? []).filter(u => u.status === "active");

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? t("dept_edit_title") : t("dept_create_title")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t("dept_name_label")} <span className="text-destructive">*</span></Label>
            <Input value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label>{t("dept_desc_label")}</Label>
            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder={t("dept_optional_desc")} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("dept_manager_label")}</Label>
            <Select value={managerId} onValueChange={setManagerId}>
              <SelectTrigger>
                <SelectValue placeholder={t("dept_select_manager")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t("none")}</SelectItem>
                {activeUsers.map(u => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    {u.fullName}
                    {u.position && <span className="text-muted-foreground text-xs ml-1">· {u.position}</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t("cancel")}</Button>
            <Button type="submit" disabled={!name || createDepartment.isPending || updateDepartment.isPending}>
              {isEdit ? t("save_changes") : t("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function DepartmentsPage() {
  const { t } = useTranslation();
  const { data: departments, isLoading } = useListDepartments();
  const deleteDepartment = useDeleteDepartment();
  const { data: me } = useGetMe();
  const { legacyDepartmentsFrozen } = useOrgCutover();
  const isAdmin = me?.role === "admin" || me?.role === "super_admin";
  const canMutateDepartments = isAdmin && !legacyDepartmentsFrozen;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<{ id: number; name: string; description?: string | null; managerId?: number | null } | null>(null);

  const handleDelete = (id: number, name: string) => {
    if (!confirm(t("dept_delete_confirm", { name }))) return;
    deleteDepartment.mutate({ id }, {
      onSuccess: () => {
        toast({ title: t("dept_deleted") });
        queryClient.invalidateQueries({ queryKey: ["/api/departments"] });
      },
      onError: (err: any) => toast({ title: t("error"), description: err?.response?.data?.error, variant: "destructive" }),
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{t("departments")}</h2>
          <p className="text-muted-foreground">{t("departments_subtitle")}</p>
        </div>
        {canMutateDepartments && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            {t("add_department")}
          </Button>
        )}
      </div>

      {legacyDepartmentsFrozen && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>{t("dept_legacy_banner_title")}</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{t("dept_legacy_banner_body")}</p>
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/hr/foundation">
                {t("dept_legacy_banner_cta")}
                <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {isLoading ? (
          [1, 2, 3].map(i => <Card key={i} className="h-36 animate-pulse bg-muted" />)
        ) : (
          departments?.map(dept => (
            <Card key={dept.id} className="hover:shadow-md transition-shadow group">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Building2 className="w-5 h-5 text-primary shrink-0" />
                    {dept.name}
                  </CardTitle>
                  {canMutateDepartments && (
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing({ id: dept.id, name: dept.name, description: dept.description, managerId: dept.managerId })}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(dept.id, dept.name)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
                <CardDescription className="line-clamp-1">{dept.description || t("no_description_dept")}</CardDescription>
              </CardHeader>
              <CardContent>
                {dept.managerName && (
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-2">
                    <UserCheck className="w-4 h-4" />
                    <span>{dept.managerName}</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-sm text-muted-foreground border-t pt-3">
                  <div className="flex items-center gap-1">
                    <Users className="w-4 h-4" />
                    <span>{t("members_count", { count: dept.memberCount })}</span>
                  </div>
                  <span>{t("created_ago", { time: formatDistanceToNow(new Date(dept.createdAt), { addSuffix: true }) })}</span>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {canMutateDepartments && createOpen && <DepartmentFormDialog open onClose={() => setCreateOpen(false)} />}
      {canMutateDepartments && editing && <DepartmentFormDialog open onClose={() => setEditing(null)} existing={editing} />}
    </div>
  );
}
