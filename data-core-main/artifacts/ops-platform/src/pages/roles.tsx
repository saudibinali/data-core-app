import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  ShieldCheck, Plus, Trash2, Loader2, Users, Save, ChevronRight,
  AlertTriangle, Search, X, UserPlus, UserMinus, RefreshCw,
  Lock, Zap, Filter, CheckSquare2, Square,
} from "lucide-react";
import {
  useListWorkspaceRoles,
  useCreateWorkspaceRole,
  useUpdateWorkspaceRole,
  useDeleteWorkspaceRole,
  useSetRolePermissions,
  useListPermissions,
  useListRoleMembers,
  useAddRoleMembers,
  useRemoveRoleMember,
  useListUsers,
  getListWorkspaceRolesQueryKey,
  getListRoleMembersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const ROLE_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#ef4444",
  "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#06b6d4", "#3b82f6", "#64748b", "#a16207",
];

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {ROLE_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={cn(
            "w-7 h-7 rounded-full border-2 transition-all",
            value === c ? "border-foreground scale-110" : "border-transparent hover:scale-105",
          )}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  );
}

// ── Permissions Panel ───────────────────────────────────────────────────────

function PermissionsPanel({
  roleId,
  existingPermissions,
  onSaved,
}: {
  roleId: number;
  existingPermissions: string[];
  onSaved: () => void;
}) {
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const { toast } = useToast();

  const { data: registry, isLoading: loadingRegistry, refetch: refetchRegistry } = useListPermissions();
  const setPermissions = useSetRolePermissions();

  const [edited, setEdited] = useState<Set<string>>(new Set(existingPermissions));
  const [changed, setChanged] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "granted" | "ungranted">("all");

  // Reset when role changes
  useEffect(() => {
    setEdited(new Set(existingPermissions));
    setChanged(false);
    setSearch("");
    setFilter("all");
  }, [roleId, existingPermissions.join(",")]);

  const groups = (registry?.groups ?? []).filter((g) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const nameMatch = (isAr && g.labelAr ? g.labelAr : g.label).toLowerCase().includes(q);
    const permMatch = g.permissions.some(p =>
      p.key.toLowerCase().includes(q) ||
      (isAr && p.labelAr ? p.labelAr : p.label).toLowerCase().includes(q)
    );
    return nameMatch || permMatch;
  });

  function getFilteredPerms(perms: { key: string; label: string; labelAr?: string }[]) {
    return perms.filter(p => {
      if (filter === "granted") return edited.has(p.key);
      if (filter === "ungranted") return !edited.has(p.key);
      if (search) {
        const q = search.toLowerCase();
        return p.key.toLowerCase().includes(q) || (isAr && p.labelAr ? p.labelAr : p.label).toLowerCase().includes(q);
      }
      return true;
    });
  }

  function toggle(key: string) {
    setEdited(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    setChanged(true);
  }

  function toggleGroup(perms: { key: string }[]) {
    const keys = perms.map(p => p.key);
    const allOn = keys.every(k => edited.has(k));
    setEdited(prev => {
      const next = new Set(prev);
      if (allOn) keys.forEach(k => next.delete(k));
      else keys.forEach(k => next.add(k));
      return next;
    });
    setChanged(true);
  }

  function handleSave() {
    setPermissions.mutate(
      { id: roleId, data: { permissions: Array.from(edited) } },
      {
        onSuccess: () => { setChanged(false); onSaved(); toast({ title: isAr ? "تم حفظ الصلاحيات" : "Permissions saved" }); },
        onError: () => toast({ title: isAr ? "فشل الحفظ" : "Failed to save", variant: "destructive" }),
      }
    );
  }

  const totalGranted = edited.size;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder={isAr ? "بحث في الصلاحيات..." : "Search permissions..."}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-8 text-sm"
          />
        </div>
        <div className="flex items-center gap-1 text-xs border border-border rounded-md overflow-hidden">
          {(["all", "granted", "ungranted"] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-3 py-1.5 transition-colors capitalize",
                filter === f ? "bg-primary text-primary-foreground" : "hover:bg-accent"
              )}
            >
              {isAr
                ? f === "all" ? "الكل" : f === "granted" ? "ممنوحة" : "غير ممنوحة"
                : f === "all" ? "All" : f === "granted" ? "Granted" : "Not granted"}
            </button>
          ))}
        </div>
        <button
          onClick={() => refetchRegistry()}
          className="p-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground"
          title={isAr ? "تحديث" : "Refresh"}
        >
          <RefreshCw className="w-4 h-4" />
        </button>
        <Badge variant="secondary" className="text-xs">
          {totalGranted} {isAr ? "ممنوحة" : "granted"}
        </Badge>
        {changed && (
          <Button size="sm" onClick={handleSave} disabled={setPermissions.isPending} className="gap-1.5 ml-auto">
            {setPermissions.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {isAr ? "حفظ التغييرات" : "Save Changes"}
          </Button>
        )}
      </div>

      {/* Dynamic resource notice */}
      <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-3 py-2 text-xs text-blue-800 dark:text-blue-300 flex items-start gap-2">
        <Zap className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          {isAr
            ? "تتحدث الصلاحيات تلقائياً عند إنشاء أي مورد جديد في المنصة: الأقسام، المجموعات، سير العمل، النماذج، وخدمات الموارد البشرية - كل إضافة جديدة تظهر هنا فور إنشائها."
            : "Permissions update automatically for every new resource created in the platform: departments, groups, workflows, forms, and HR services - each new entry appears here instantly."}
        </span>
      </div>

      {/* Groups */}
      {loadingRegistry ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
        </div>
      ) : groups.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground text-sm">
          {isAr ? "لا توجد صلاحيات مطابقة" : "No permissions match your search"}
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(group => {
            const filteredPerms = getFilteredPerms(group.permissions);
            if (filteredPerms.length === 0) return null;
            const allOn = filteredPerms.every(p => edited.has(p.key));
            const someOn = filteredPerms.some(p => edited.has(p.key));
            const grantedCount = filteredPerms.filter(p => edited.has(p.key)).length;
            const groupName = isAr && group.labelAr ? group.labelAr : group.label;

            return (
              <div key={group.module} className="rounded-xl border border-border bg-card overflow-hidden">
                <div
                  className="flex items-center justify-between px-4 py-3 bg-muted/40 border-b border-border cursor-pointer hover:bg-muted/60 transition-colors"
                  onClick={() => toggleGroup(filteredPerms)}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {groupName}
                    </span>
                    {group.dynamic && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-blue-300 text-blue-600 dark:text-blue-400">
                        <Zap className="w-2.5 h-2.5 mr-1" />
                        {isAr ? "ديناميكي" : "Dynamic"}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{grantedCount}/{filteredPerms.length}</span>
                    {allOn ? (
                      <CheckSquare2 className="w-4 h-4 text-primary" />
                    ) : someOn ? (
                      <div className="w-4 h-4 rounded border-2 border-primary flex items-center justify-center">
                        <div className="w-1.5 h-1.5 rounded-sm bg-primary" />
                      </div>
                    ) : (
                      <Square className="w-4 h-4 text-muted-foreground/50" />
                    )}
                  </div>
                </div>
                <div className="divide-y divide-border">
                  {filteredPerms.map(perm => {
                    const permLabel = isAr && perm.labelAr ? perm.labelAr : perm.label;
                    return (
                      <label
                        key={perm.key}
                        className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-accent/30 transition-colors"
                      >
                        <Checkbox
                          checked={edited.has(perm.key)}
                          onCheckedChange={() => toggle(perm.key)}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm">{permLabel}</p>
                          <p className="text-xs text-muted-foreground font-mono truncate">{perm.key}</p>
                        </div>
                        {edited.has(perm.key) && (
                          <Lock className="w-3 h-3 text-primary/60 shrink-0" />
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {changed && (
        <div className="flex justify-end pt-2">
          <Button onClick={handleSave} disabled={setPermissions.isPending} className="gap-1.5">
            {setPermissions.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isAr ? "حفظ الصلاحيات" : "Save Permissions"}
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Members Panel ───────────────────────────────────────────────────────────

function MembersPanel({ roleId, roleColor }: { roleId: number; roleColor: string }) {
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [showAdd, setShowAdd] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const { data: members = [], isLoading: loadingMembers, refetch: refetchMembers } = useListRoleMembers(
    roleId,
    { query: { queryKey: getListRoleMembersQueryKey(roleId) } }
  );

  const { data: allUsers = [] } = useListUsers();

  const addMutation    = useAddRoleMembers();
  const removeMutation = useRemoveRoleMember();

  const memberIds = new Set((members as any[]).map((m: any) => m.id));

  const candidates = (allUsers as any[]).filter((u: any) => {
    if (memberIds.has(u.id)) return false;
    if (!addSearch) return true;
    const q = addSearch.toLowerCase();
    return (
      (u.fullName ?? "").toLowerCase().includes(q) ||
      (u.email ?? "").toLowerCase().includes(q) ||
      (u.position ?? "").toLowerCase().includes(q)
    );
  });

  function toggleSelect(id: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleAdd() {
    if (selected.size === 0) return;
    addMutation.mutate(
      { id: roleId, data: { userIds: Array.from(selected) } },
      {
        onSuccess: () => {
          toast({ title: isAr ? `تم إضافة ${selected.size} مستخدم` : `${selected.size} user(s) added` });
          setShowAdd(false);
          setSelected(new Set());
          setAddSearch("");
          refetchMembers();
          queryClient.invalidateQueries({ queryKey: getListWorkspaceRolesQueryKey() });
        },
        onError: () => toast({ title: isAr ? "فشل الإضافة" : "Failed to add", variant: "destructive" }),
      }
    );
  }

  function handleRemove(userId: number, name: string) {
    removeMutation.mutate(
      { id: roleId, userId },
      {
        onSuccess: () => {
          toast({ title: isAr ? `تمت إزالة ${name}` : `${name} removed from role` });
          refetchMembers();
          queryClient.invalidateQueries({ queryKey: getListWorkspaceRolesQueryKey() });
        },
        onError: () => toast({ title: isAr ? "فشل الحذف" : "Failed to remove", variant: "destructive" }),
      }
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {(members as any[]).length} {isAr ? "مستخدم مخصص لهذا الدور" : "user(s) assigned to this role"}
        </p>
        <Button size="sm" variant="outline" onClick={() => setShowAdd(true)} className="gap-1.5">
          <UserPlus className="w-4 h-4" />
          {isAr ? "إضافة مستخدمين" : "Add Users"}
        </Button>
      </div>

      {/* Add users dialog */}
      {showAdd && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 dark:bg-primary/10 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{isAr ? "اختر مستخدمين لإضافتهم" : "Select users to add"}</p>
            <button onClick={() => { setShowAdd(false); setSelected(new Set()); setAddSearch(""); }} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder={isAr ? "بحث بالاسم أو البريد..." : "Search by name or email..."}
              value={addSearch}
              onChange={e => setAddSearch(e.target.value)}
              className="pl-9 h-8 text-sm"
            />
          </div>

          <div className="max-h-52 overflow-y-auto space-y-1 rounded-lg border border-border bg-background">
            {candidates.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-6">
                {isAr ? "لا توجد مستخدمين متاحين" : "No available users"}
              </p>
            ) : (
              candidates.map((u: any) => (
                <label key={u.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-accent transition-colors">
                  <Checkbox
                    checked={selected.has(u.id)}
                    onCheckedChange={() => toggleSelect(u.id)}
                  />
                  <img
                    src={u.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${u.fullName}`}
                    alt={u.fullName}
                    className="w-7 h-7 rounded-full shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{u.fullName}</p>
                    <p className="text-xs text-muted-foreground truncate">{u.email ?? u.position}</p>
                  </div>
                </label>
              ))
            )}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {selected.size > 0 && `${selected.size} ${isAr ? "محدد" : "selected"}`}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => { setShowAdd(false); setSelected(new Set()); setAddSearch(""); }}>
                {isAr ? "إلغاء" : "Cancel"}
              </Button>
              <Button size="sm" disabled={selected.size === 0 || addMutation.isPending} onClick={handleAdd} className="gap-1.5">
                {addMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {isAr ? `إضافة (${selected.size})` : `Add (${selected.size})`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Members list */}
      {loadingMembers ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
        </div>
      ) : (members as any[]).length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
            <Users className="w-6 h-6 text-muted-foreground/60" />
          </div>
          <p className="text-sm text-muted-foreground">
            {isAr ? "لا يوجد مستخدمون مخصصون لهذا الدور" : "No users assigned to this role yet"}
          </p>
          <Button size="sm" variant="outline" className="mt-3 gap-1.5" onClick={() => setShowAdd(true)}>
            <UserPlus className="w-4 h-4" />
            {isAr ? "إضافة مستخدمين" : "Add Users"}
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {(members as any[]).map((member: any) => (
            <div
              key={member.id}
              className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-card hover:shadow-sm transition-shadow"
            >
              <img
                src={member.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${member.fullName}`}
                alt={member.fullName}
                className="w-9 h-9 rounded-full shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{member.fullName}</p>
                <p className="text-xs text-muted-foreground truncate">{member.email ?? member.position}</p>
              </div>
              <Badge
                variant="outline"
                className="text-xs shrink-0"
                style={{ borderColor: roleColor + "60", color: roleColor }}
              >
                {member.role}
              </Badge>
              <button
                onClick={() => handleRemove(member.id, member.fullName)}
                disabled={removeMutation.isPending}
                className="p-1.5 rounded-md hover:bg-destructive/10 hover:text-destructive transition-colors text-muted-foreground"
                title={isAr ? "إزالة من الدور" : "Remove from role"}
              >
                <UserMinus className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function RolesPage() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: roles = [], isLoading } = useListWorkspaceRoles();

  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editColor, setEditColor] = useState(ROLE_COLORS[0]);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createColor, setCreateColor] = useState(ROLE_COLORS[0]);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [sidebarSearch, setSidebarSearch] = useState("");

  const selectedRole = (roles as any[]).find((r: any) => r.id === selectedRoleId) ?? null;

  useEffect(() => {
    if (selectedRole) {
      setEditName(selectedRole.name);
      setEditDescription(selectedRole.description ?? "");
      setEditColor(selectedRole.color);
    }
  }, [selectedRoleId, roles]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListWorkspaceRolesQueryKey() });

  const createRole = useCreateWorkspaceRole({
    mutation: {
      onSuccess: (data: any) => {
        invalidate();
        setShowCreate(false);
        setCreateName("");
        setCreateDescription("");
        setCreateColor(ROLE_COLORS[0]);
        setSelectedRoleId(data.id);
        toast({ title: isAr ? "تم إنشاء الدور" : "Role created" });
      },
      onError: () => toast({ title: isAr ? "حدث خطأ" : "Error", variant: "destructive" }),
    },
  });

  const updateRole = useUpdateWorkspaceRole({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: isAr ? "تم تحديث الدور" : "Role updated" }); },
      onError: () => toast({ title: isAr ? "حدث خطأ" : "Error", variant: "destructive" }),
    },
  });

  const deleteRole = useDeleteWorkspaceRole({
    mutation: {
      onSuccess: () => {
        invalidate();
        setSelectedRoleId(null);
        setDeleteConfirmId(null);
        toast({ title: isAr ? "تم حذف الدور" : "Role deleted" });
      },
      onError: () => toast({ title: isAr ? "حدث خطأ" : "Error", variant: "destructive" }),
    },
  });

  function handleSaveDetails() {
    if (!selectedRoleId) return;
    updateRole.mutate({ id: selectedRoleId, data: { name: editName, description: editDescription || null, color: editColor } });
  }

  function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!createName.trim()) return;
    createRole.mutate({ data: { name: createName.trim(), description: createDescription || null, color: createColor } });
  }

  const filteredRoles = (roles as any[]).filter((r: any) => {
    if (!sidebarSearch) return true;
    return r.name.toLowerCase().includes(sidebarSearch.toLowerCase());
  });

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left Panel: Role List ─────────────────────────────────────────── */}
      <div className="w-72 shrink-0 border-r border-border flex flex-col bg-background">
        <div className="p-4 border-b border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" />
              <h1 className="text-base font-semibold">{isAr ? "الأدوار والصلاحيات" : "Roles & Permissions"}</h1>
            </div>
            <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => setShowCreate(true)}>
              <Plus className="w-3.5 h-3.5" />
              {isAr ? "دور جديد" : "New"}
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder={isAr ? "بحث..." : "Search roles..."}
              value={sidebarSearch}
              onChange={e => setSidebarSearch(e.target.value)}
              className="pl-8 h-8 text-xs"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {isLoading ? (
            <div className="space-y-2 px-3 py-2">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
            </div>
          ) : filteredRoles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center gap-2">
              <ShieldCheck className="w-8 h-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">{isAr ? "لا توجد أدوار" : "No roles yet"}</p>
              <Button size="sm" variant="outline" onClick={() => setShowCreate(true)} className="gap-1.5 text-xs">
                <Plus className="w-3.5 h-3.5" />
                {isAr ? "إنشاء أول دور" : "Create first role"}
              </Button>
            </div>
          ) : (
            filteredRoles.map((role: any) => (
              <button
                key={role.id}
                onClick={() => setSelectedRoleId(role.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50 group",
                  selectedRoleId === role.id && "bg-accent",
                )}
              >
                <span
                  className="w-3 h-3 rounded-full shrink-0 ring-1 ring-black/10"
                  style={{ backgroundColor: role.color }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{role.name}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                    <Users className="w-3 h-3" />
                    {role.userCount} {isAr ? "مستخدم" : "members"}
                    <span className="mx-1">·</span>
                    <Lock className="w-3 h-3" />
                    {role.permissions?.length ?? 0} {isAr ? "صلاحية" : "perms"}
                  </p>
                </div>
                <ChevronRight className={cn(
                  "w-4 h-4 text-muted-foreground/40 shrink-0 transition-opacity",
                  selectedRoleId === role.id ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                )} />
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Right Panel: Role Editor ───────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {!selectedRole ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
              <ShieldCheck className="w-8 h-8 text-muted-foreground/60" />
            </div>
            <div>
              <p className="text-base font-medium">{isAr ? "اختر دوراً" : "Select a role"}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {isAr ? "اختر دوراً من القائمة لإدارة صلاحياته وأعضائه" : "Select a role to manage its permissions and members"}
              </p>
            </div>
            <Button variant="outline" onClick={() => setShowCreate(true)} className="mt-2 gap-2">
              <Plus className="w-4 h-4" />
              {isAr ? "إنشاء دور جديد" : "Create New Role"}
            </Button>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto py-6 px-6 space-y-6">
            {/* Role header */}
            <div className="flex items-center gap-3">
              <span className="w-5 h-5 rounded-full ring-1 ring-black/10 shrink-0" style={{ backgroundColor: selectedRole.color }} />
              <h2 className="text-xl font-bold">{selectedRole.name}</h2>
              <Badge variant="secondary" className="text-xs gap-1">
                <Users className="w-3 h-3" />
                {selectedRole.userCount} {isAr ? "مستخدم" : "members"}
              </Badge>
              <Badge variant="secondary" className="text-xs gap-1">
                <Lock className="w-3 h-3" />
                {selectedRole.permissions?.length ?? 0} {isAr ? "صلاحية" : "perms"}
              </Badge>
            </div>

            {/* Tabs */}
            <Tabs defaultValue="permissions">
              <TabsList className="w-full justify-start">
                <TabsTrigger value="permissions" className="gap-2">
                  <Lock className="w-4 h-4" />
                  {isAr ? "الصلاحيات" : "Permissions"}
                </TabsTrigger>
                <TabsTrigger value="members" className="gap-2">
                  <Users className="w-4 h-4" />
                  {isAr ? "الأعضاء" : "Members"}
                  {selectedRole.userCount > 0 && (
                    <Badge className="ml-1 h-4 px-1.5 text-[10px]">{selectedRole.userCount}</Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="details" className="gap-2">
                  <ShieldCheck className="w-4 h-4" />
                  {isAr ? "تفاصيل الدور" : "Role Details"}
                </TabsTrigger>
              </TabsList>

              {/* ── Permissions tab ─────────────────────────────────────────── */}
              <TabsContent value="permissions" className="mt-4">
                <PermissionsPanel
                  roleId={selectedRole.id}
                  existingPermissions={selectedRole.permissions ?? []}
                  onSaved={invalidate}
                />
              </TabsContent>

              {/* ── Members tab ─────────────────────────────────────────────── */}
              <TabsContent value="members" className="mt-4">
                <MembersPanel roleId={selectedRole.id} roleColor={selectedRole.color} />
              </TabsContent>

              {/* ── Details tab ─────────────────────────────────────────────── */}
              <TabsContent value="details" className="mt-4">
                <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                  <h3 className="text-sm font-medium">{isAr ? "تفاصيل الدور" : "Role Details"}</h3>

                  <div className="space-y-1.5">
                    <Label htmlFor="edit-name">{isAr ? "اسم الدور" : "Role Name"}</Label>
                    <Input
                      id="edit-name"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      placeholder={isAr ? "اسم الدور" : "Role name"}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="edit-desc">{isAr ? "الوصف" : "Description"}</Label>
                    <Textarea
                      id="edit-desc"
                      value={editDescription}
                      onChange={e => setEditDescription(e.target.value)}
                      placeholder={isAr ? "وصف مختصر للدور..." : "Brief description of this role..."}
                      rows={2}
                      className="resize-none"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>{isAr ? "لون الدور" : "Role Color"}</Label>
                    <ColorPicker value={editColor} onChange={setEditColor} />
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive gap-1.5"
                      onClick={() => setDeleteConfirmId(selectedRole.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {isAr ? "حذف الدور" : "Delete Role"}
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSaveDetails}
                      disabled={updateRole.isPending || !editName.trim()}
                      className="gap-1.5"
                    >
                      {updateRole.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                      {isAr ? "حفظ التفاصيل" : "Save Details"}
                    </Button>
                  </div>
                </div>

                {/* Delete confirmation */}
                {deleteConfirmId === selectedRole.id && (
                  <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3">
                    <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                    <div className="flex-1 space-y-3">
                      <p className="text-sm text-destructive">
                        {isAr
                          ? `هل أنت متأكد من حذف دور "${selectedRole.name}"؟ سيتم إلغاء تعيين جميع أعضائه.`
                          : `Delete role "${selectedRole.name}"? All ${selectedRole.userCount} assigned users will be unassigned.`}
                      </p>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setDeleteConfirmId(null)}>
                          {isAr ? "إلغاء" : "Cancel"}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={deleteRole.isPending}
                          onClick={() => deleteRole.mutate({ id: selectedRole.id })}
                        >
                          {deleteRole.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}
                          {isAr ? "حذف" : "Delete"}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>

      {/* ── Create Role Modal ─────────────────────────────────────────────── */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
          <div
            className="bg-background rounded-2xl shadow-xl border border-border w-full max-w-md mx-4 p-6 space-y-5"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">{isAr ? "إنشاء دور جديد" : "Create New Role"}</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {isAr ? "يمكنك تخصيص الصلاحيات والأعضاء بعد الإنشاء" : "Customize permissions and members after creation"}
                </p>
              </div>
              <button onClick={() => setShowCreate(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="create-name">{isAr ? "اسم الدور" : "Role Name"} *</Label>
                <Input
                  id="create-name"
                  value={createName}
                  onChange={e => setCreateName(e.target.value)}
                  placeholder={isAr ? "مثال: مشرف النماذج" : "e.g. Forms Supervisor"}
                  autoFocus
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="create-desc">
                  {isAr ? "الوصف" : "Description"}
                  <span className="text-muted-foreground text-xs ml-1">({isAr ? "اختياري" : "optional"})</span>
                </Label>
                <Textarea
                  id="create-desc"
                  value={createDescription}
                  onChange={e => setCreateDescription(e.target.value)}
                  placeholder={isAr ? "وصف مختصر لمهام هذا الدور..." : "Brief description of this role's responsibilities..."}
                  rows={2}
                  className="resize-none"
                />
              </div>

              <div className="space-y-2">
                <Label>{isAr ? "لون الدور" : "Role Color"}</Label>
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-full ring-1 ring-black/10" style={{ backgroundColor: createColor }} />
                  <ColorPicker value={createColor} onChange={setCreateColor} />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>
                  {isAr ? "إلغاء" : "Cancel"}
                </Button>
                <Button type="submit" disabled={createRole.isPending || !createName.trim()} className="gap-1.5">
                  {createRole.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  {createRole.isPending ? (isAr ? "جارٍ الإنشاء..." : "Creating...") : (isAr ? "إنشاء الدور" : "Create Role")}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
