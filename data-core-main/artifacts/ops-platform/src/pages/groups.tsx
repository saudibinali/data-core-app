import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useListGroups, useCreateGroup, useGetGroup, useUpdateGroup,
  useDeleteGroup, useAddGroupMember, useRemoveGroupMember, useListUsers, useGetMe,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Users, Globe, Lock, ShieldCheck, Pencil, Trash2, UserPlus, UserMinus, Search } from "lucide-react";

type SendPerms = "members_only" | "admins_only" | "workspace";
type Visibility = "workspace" | "private" | "admins_only";
type Moderation = "none" | "moderated";

interface GroupFormState {
  name: string;
  emailAlias: string;
  description: string;
  sendPermissions: SendPerms;
  visibility: Visibility;
  moderation: Moderation;
}

const defaultForm = (): GroupFormState => ({
  name: "",
  emailAlias: "",
  description: "",
  sendPermissions: "members_only",
  visibility: "workspace",
  moderation: "none",
});

function VisibilityBadge({ v }: { v: string }) {
  const { t } = useTranslation();
  if (v === "private")
    return <Badge variant="secondary" className="gap-1"><Lock className="w-3 h-3" />{t("vis_private")}</Badge>;
  if (v === "admins_only")
    return <Badge variant="outline" className="gap-1"><ShieldCheck className="w-3 h-3" />{t("vis_admins_only")}</Badge>;
  return <Badge variant="outline" className="gap-1 text-emerald-600 border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-800"><Globe className="w-3 h-3" />{t("vis_workspace")}</Badge>;
}

// ─── Create/Edit Group Dialog ─────────────────────────────────────────────────

function GroupFormDialog({
  open, onClose, groupId,
}: { open: boolean; onClose: () => void; groupId?: number }) {
  const { t } = useTranslation();
  const isEdit = !!groupId;
  const { data: existing } = useGetGroup(groupId!, { query: { enabled: !!groupId, queryKey: [`/api/groups/${groupId}`] } });
  const [form, setForm] = useState<GroupFormState>(defaultForm());
  const createGroup = useCreateGroup();
  const updateGroup = useUpdateGroup();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const display = isEdit && existing
    ? { name: existing.name, emailAlias: existing.emailAlias ?? "", description: existing.description ?? "", sendPermissions: existing.sendPermissions as SendPerms, visibility: existing.visibility as Visibility, moderation: existing.moderation as Moderation }
    : form;

  const setF = (k: keyof GroupFormState, v: string) => {
    if (isEdit) return;
    setForm(prev => ({ ...prev, [k]: v }));
  };
  const [editForm, setEditForm] = useState<Partial<GroupFormState>>({});
  const setEF = (k: keyof GroupFormState, v: string) => setEditForm(prev => ({ ...prev, [k]: v }));
  const get = (k: keyof GroupFormState) => isEdit ? ((editForm[k] ?? display[k]) as string) : form[k];

  const handleSave = () => {
    const payload = {
      name: get("name"),
      emailAlias: get("emailAlias") || null,
      description: get("description") || null,
      sendPermissions: get("sendPermissions") as SendPerms,
      visibility: get("visibility") as Visibility,
      moderation: get("moderation") as Moderation,
    };

    if (isEdit) {
      updateGroup.mutate({ id: groupId!, data: payload as any }, {
        onSuccess: () => {
          toast({ title: t("group_updated") });
          queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
          queryClient.invalidateQueries({ queryKey: [`/api/groups/${groupId}`] });
          setEditForm({});
          onClose();
        },
        onError: (err: any) => toast({ title: t("error"), description: err?.response?.data?.error, variant: "destructive" }),
      });
    } else {
      createGroup.mutate({ data: payload as any }, {
        onSuccess: () => {
          toast({ title: t("group_created") });
          queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
          setForm(defaultForm());
          onClose();
        },
        onError: (err: any) => toast({ title: t("error"), description: err?.response?.data?.error, variant: "destructive" }),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? t("edit_group_title") : t("create_group_title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label>{t("group_name_label")} <span className="text-destructive">*</span></Label>
            <Input value={get("name")} onChange={e => isEdit ? setEF("name", e.target.value) : setF("name", e.target.value)} placeholder="e.g. All Employees" />
          </div>
          <div className="space-y-1.5">
            <Label>{t("email_alias_label")} <span className="text-muted-foreground text-xs">({t("email_alias_optional")})</span></Label>
            <Input value={get("emailAlias")} onChange={e => isEdit ? setEF("emailAlias", e.target.value) : setF("emailAlias", e.target.value)} placeholder="all-employees@company.com" />
          </div>
          <div className="space-y-1.5">
            <Label>{t("group_desc_label")}</Label>
            <Input value={get("description")} onChange={e => isEdit ? setEF("description", e.target.value) : setF("description", e.target.value)} placeholder={t("group_desc_placeholder")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("visibility_label")}</Label>
              <Select value={get("visibility")} onValueChange={v => isEdit ? setEF("visibility", v) : setF("visibility", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="workspace">{t("vis_workspace")}</SelectItem>
                  <SelectItem value="private">{t("vis_private")}</SelectItem>
                  <SelectItem value="admins_only">{t("vis_admins_only")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("who_can_send_label")}</Label>
              <Select value={get("sendPermissions")} onValueChange={v => isEdit ? setEF("sendPermissions", v) : setF("sendPermissions", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="members_only">{t("send_members_only")}</SelectItem>
                  <SelectItem value="admins_only">{t("send_admins_only")}</SelectItem>
                  <SelectItem value="workspace">{t("send_everyone")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t("moderation_label")}</Label>
            <Select value={get("moderation")} onValueChange={v => isEdit ? setEF("moderation", v) : setF("moderation", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("mod_none")}</SelectItem>
                <SelectItem value="moderated">{t("mod_moderated")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("cancel")}</Button>
          <Button onClick={handleSave} disabled={!get("name") || createGroup.isPending || updateGroup.isPending}>
            {isEdit ? t("save_changes") : t("create_group_btn")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Group Detail Dialog ──────────────────────────────────────────────────────

function GroupDetailDialog({ groupId, isAdmin, onClose, onEdit }: {
  groupId: number; isAdmin: boolean; onClose: () => void; onEdit: () => void;
}) {
  const { t } = useTranslation();
  const { data: group, isLoading } = useGetGroup(groupId, { query: { enabled: true, queryKey: [`/api/groups/${groupId}`] } });
  const { data: allUsers } = useListUsers();
  const addMember = useAddGroupMember();
  const removeMember = useRemoveGroupMember();
  const deleteGroup = useDeleteGroup();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [addUserId, setAddUserId] = useState("");
  const [search, setSearch] = useState("");

  const handleAddMember = () => {
    if (!addUserId) return;
    addMember.mutate({ id: groupId, data: { userId: parseInt(addUserId), isOwner: false } }, {
      onSuccess: () => {
        toast({ title: t("group_updated") });
        queryClient.invalidateQueries({ queryKey: [`/api/groups/${groupId}`] });
        queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
        setAddUserId("");
      },
      onError: (err: any) => toast({ title: t("error"), description: err?.response?.data?.error, variant: "destructive" }),
    });
  };

  const handleRemoveMember = (userId: number, name: string) => {
    removeMember.mutate({ id: groupId, userId }, {
      onSuccess: () => {
        toast({ title: t("member_removed", { name }) });
        queryClient.invalidateQueries({ queryKey: [`/api/groups/${groupId}`] });
        queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      },
    });
  };

  const handleDelete = () => {
    deleteGroup.mutate({ id: groupId }, {
      onSuccess: () => {
        toast({ title: t("group_deleted") });
        queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
        onClose();
      },
    });
  };

  const memberIds = new Set((group as any)?.members?.map((m: any) => m.userId) ?? []);
  const eligible = (allUsers ?? []).filter(u => !memberIds.has(u.id));
  const filteredMembers = ((group as any)?.members ?? []).filter((m: any) =>
    m.fullName.toLowerCase().includes(search.toLowerCase()) ||
    m.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <DialogTitle className="text-lg">{group?.name}</DialogTitle>
              {group?.description && <p className="text-sm text-muted-foreground mt-0.5">{group.description}</p>}
            </div>
            {isAdmin && (
              <div className="flex gap-1 shrink-0">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}><Pencil className="w-3.5 h-3.5" /></Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={handleDelete}><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
            )}
          </div>
        </DialogHeader>

        {isLoading ? (
          <div className="h-32 flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 text-xs">
              <VisibilityBadge v={group?.visibility ?? "workspace"} />
              {group?.emailAlias && (
                <Badge variant="outline" className="font-mono">{group.emailAlias}</Badge>
              )}
              <Badge variant="outline">{t("members_count", { count: group?.memberCount ?? 0 })}</Badge>
            </div>

            <Separator />

            {isAdmin && (
              <div className="flex gap-2">
                <Select value={addUserId} onValueChange={setAddUserId}>
                  <SelectTrigger className="flex-1 h-8 text-sm">
                    <SelectValue placeholder={t("add_member_placeholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {eligible.map(u => (
                      <SelectItem key={u.id} value={String(u.id)}>
                        {u.fullName} <span className="text-muted-foreground text-xs ml-1">{u.email}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={handleAddMember} disabled={!addUserId || addMember.isPending}>
                  <UserPlus className="w-4 h-4" />
                </Button>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  className="h-7 text-sm border-0 px-0 focus-visible:ring-0 bg-transparent"
                  placeholder={t("search_members")}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              <div className="max-h-64 overflow-y-auto space-y-1">
                {filteredMembers.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">{t("no_members_yet")}</p>
                ) : (
                  filteredMembers.map((m: any) => (
                    <div key={m.id} className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 group">
                      <img
                        src={m.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${m.fullName}`}
                        alt={m.fullName}
                        className="w-7 h-7 rounded-full"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{m.fullName}</p>
                        <p className="text-xs text-muted-foreground truncate">{m.position ?? m.email}</p>
                      </div>
                      {m.isOwner && <Badge variant="secondary" className="text-xs shrink-0">{t("owner_badge")}</Badge>}
                      {isAdmin && (
                        <Button
                          variant="ghost" size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                          onClick={() => handleRemoveMember(m.userId, m.fullName)}
                        >
                          <UserMinus className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function GroupsPage() {
  const { t } = useTranslation();
  const { data: groups, isLoading } = useListGroups();
  const { data: me } = useGetMe();
  const isAdmin = me?.role === "admin" || me?.role === "super_admin";

  const [createOpen, setCreateOpen] = useState(false);
  const [editGroupId, setEditGroupId] = useState<number | null>(null);
  const [detailGroupId, setDetailGroupId] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const filtered = (groups ?? []).filter(g =>
    g.name.toLowerCase().includes(search.toLowerCase()) ||
    (g.description ?? "").toLowerCase().includes(search.toLowerCase()) ||
    (g.emailAlias ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{t("groups")}</h2>
          <p className="text-muted-foreground">{t("groups_subtitle")}</p>
        </div>
        {isAdmin && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            {t("new_group")}
          </Button>
        )}
      </div>

      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input className="pl-9" placeholder={t("search_groups")} value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map(i => <Card key={i} className="h-36 animate-pulse bg-muted" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
          <Users className="w-10 h-10 opacity-30" />
          <p className="text-sm">{t("no_groups_found")}</p>
          {isAdmin && <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>{t("create_first_group")}</Button>}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map(group => (
            <Card
              key={group.id}
              className="hover:shadow-md transition-shadow cursor-pointer group"
              onClick={() => setDetailGroupId(group.id)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base truncate">{group.name}</CardTitle>
                    {group.emailAlias && (
                      <p className="text-xs text-muted-foreground font-mono truncate mt-0.5">{group.emailAlias}</p>
                    )}
                  </div>
                  {isAdmin && (
                    <Button
                      variant="ghost" size="icon"
                      className="h-7 w-7 opacity-0 group-hover:opacity-100 shrink-0"
                      onClick={e => { e.stopPropagation(); setEditGroupId(group.id); }}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
                {group.description && (
                  <CardDescription className="line-clamp-2 mt-1">{group.description}</CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between pt-3 border-t mt-2">
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Users className="w-4 h-4" />
                    <span>{t("members_count", { count: group.memberCount })}</span>
                  </div>
                  <VisibilityBadge v={group.visibility} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {createOpen && (
        <GroupFormDialog open onClose={() => setCreateOpen(false)} />
      )}
      {editGroupId && (
        <GroupFormDialog open onClose={() => setEditGroupId(null)} groupId={editGroupId} />
      )}
      {detailGroupId && !editGroupId && (
        <GroupDetailDialog
          groupId={detailGroupId}
          isAdmin={isAdmin}
          onClose={() => setDetailGroupId(null)}
          onEdit={() => { setEditGroupId(detailGroupId); setDetailGroupId(null); }}
        />
      )}
    </div>
  );
}
