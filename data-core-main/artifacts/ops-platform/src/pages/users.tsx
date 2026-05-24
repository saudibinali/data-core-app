import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  useListUsers, useListInvitations, useCreateInvitation, useCancelInvitation,
  useAdminCreateUser, useGetMe, useUpdateUser, useAdminResetUserPassword,
  useDeleteUser, useListDepartments, useListWorkspaceRoles,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Search, UserPlus, Mail, Trash2, Plus, KeyRound, Pencil,
  ShieldCheck, Building2, UserCog, ChevronsUpDown, Hash, Users,
  ChevronDown,
} from "lucide-react";
import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import EmployeeAccountProvisionDialog from "@/components/hr/employee-account-provision-dialog";

type Role = "admin" | "manager" | "member";

// ─── Invite user dialog ──────────────────────────────────────────────────────

function InviteUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const { toast } = useToast();
  const createInvitation = useCreateInvitation();
  const queryClient = useQueryClient();

  const handleInvite = () => {
    if (!email) return;
    createInvitation.mutate({ data: { email, role } }, {
      onSuccess: () => {
        toast({ title: t("invitation_sent"), description: t("invitation_sent_desc", { email }) });
        queryClient.invalidateQueries({ queryKey: ["/api/invitations"] });
        setEmail(""); setRole("member"); onClose();
      },
      onError: (err: any) => {
        toast({ title: t("error"), description: err?.response?.data?.error, variant: "destructive" });
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("invite_dialog_title")}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>{t("email_address")}</Label>
            <Input type="email" placeholder="colleague@company.com" value={email}
              onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleInvite()} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("role")}</Label>
            <RoleSelect value={role} onChange={(v) => setRole(v as Role)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("cancel")}</Button>
          <Button onClick={handleInvite} disabled={!email || createInvitation.isPending}>
            {createInvitation.isPending ? t("sending") : t("send_invitation")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Create employee dialog ───────────────────────────────────────────────────

type FieldErrors = Partial<Record<"firstName" | "lastName" | "password" | "email", string>>;

const EMPTY_FORM = {
  firstName: "", lastName: "", email: "",
  password: "", role: "member" as Role, customRoleId: "__none__",
  position: "", departmentIds: [] as number[], mustResetPassword: false,
};

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="text-xs text-destructive mt-1">{msg}</p>;
}

function CreateUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const [accountType, setAccountType] = useState<"employee" | "general">("employee");
  const [form, setForm] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const { toast } = useToast();
  const adminCreateUser = useAdminCreateUser();
  const { data: departments } = useListDepartments({});
  const queryClient = useQueryClient();

  const set = (key: keyof typeof EMPTY_FORM, val: any) => {
    setForm(f => ({ ...f, [key]: val }));
    // Clear field error as user types
    if (key in fieldErrors) setFieldErrors(fe => { const next = { ...fe }; delete next[key as keyof FieldErrors]; return next; });
    setApiError(null);
  };

  const fullName = `${form.firstName} ${form.lastName}`.trim();

  const handleClose = () => {
    setAccountType("employee");
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setApiError(null);
    onClose();
  };

  const validate = (): FieldErrors => {
    const errors: FieldErrors = {};
    if (!form.firstName.trim()) errors.firstName = t("field_required");
    if (!form.lastName.trim()) errors.lastName = t("field_required");
    if (!form.password) {
      errors.password = t("field_required");
    } else if (form.password.length < 8) {
      errors.password = t("password_min_8");
    }
    if (form.email.trim()) {
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRe.test(form.email.trim())) errors.email = t("invalid_email");
    }
    return errors;
  };

  const handleCreate = () => {
    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    adminCreateUser.mutate({
      data: {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim() || null,
        password: form.password,
        role: form.role,
        customRoleId: form.customRoleId !== "__none__" ? Number(form.customRoleId) : null,
        position: form.position.trim() || null,
        departmentIds: form.departmentIds,
        mustResetPassword: form.mustResetPassword,
      } as any
    }, {
      onSuccess: () => {
        toast({ title: t("user_created"), description: t("user_created_desc", { name: fullName }) });
        queryClient.invalidateQueries({ queryKey: ["/api/users"] });
        handleClose();
      },
      onError: (err: any) => {
        const data = err?.response?.data;
        const message: string = data?.error ?? t("create_failed");
        const field: string | undefined = data?.field;

        if (field && field in EMPTY_FORM) {
          setFieldErrors({ [field]: message } as FieldErrors);
        } else {
          setApiError(message);
        }
      },
    });
  };

  const hasFieldErrors = Object.keys(fieldErrors).length > 0;
  const passwordLen = form.password.length;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-4 h-4" />
            {isAr ? "إنشاء مستخدم جديد" : "Create new user"}
          </DialogTitle>
        </DialogHeader>

        <Tabs value={accountType} onValueChange={(v) => setAccountType(v as "employee" | "general")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="employee">{isAr ? "موظف حالي" : "Existing employee"}</TabsTrigger>
            <TabsTrigger value="general">{isAr ? "حساب عام" : "General account"}</TabsTrigger>
          </TabsList>

          <TabsContent value="employee" className="mt-4">
            <EmployeeAccountProvisionDialog
              embedded
              open={accountType === "employee" && open}
              onClose={handleClose}
              isAr={isAr}
              onSuccess={() => queryClient.invalidateQueries({ queryKey: ["/api/users"] })}
            />
          </TabsContent>

          <TabsContent value="general" className="mt-4 space-y-4">

          {/* Name row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("first_name")} <span className="text-destructive">*</span></Label>
              <Input
                placeholder="Jane"
                value={form.firstName}
                onChange={(e) => set("firstName", e.target.value)}
                className={cn(fieldErrors.firstName && "border-destructive focus-visible:ring-destructive/30")}
              />
              <FieldError msg={fieldErrors.firstName} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("last_name")} <span className="text-destructive">*</span></Label>
              <Input
                placeholder="Smith"
                value={form.lastName}
                onChange={(e) => set("lastName", e.target.value)}
                className={cn(fieldErrors.lastName && "border-destructive focus-visible:ring-destructive/30")}
              />
              <FieldError msg={fieldErrors.lastName} />
            </div>
          </div>

          <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/50 border text-sm text-muted-foreground">
            <Hash className="w-3.5 h-3.5 shrink-0" />
            <span>{isAr ? "يُولَّد رقم EXT- تلقائياً (حساب غير مرتبط بـ HR)" : "An EXT- number is auto-generated (not linked to HR)"}</span>
          </div>

          {/* Password */}
          <div className="space-y-1.5">
            <Label>{t("initial_password")} <span className="text-destructive">*</span></Label>
            <Input
              type="password"
              placeholder={t("min_8_chars")}
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              className={cn(fieldErrors.password && "border-destructive focus-visible:ring-destructive/30")}
            />
            {fieldErrors.password
              ? <FieldError msg={fieldErrors.password} />
              : <p className={cn("text-xs", passwordLen > 0 && passwordLen < 8 ? "text-amber-500" : "text-muted-foreground")}>
                  {passwordLen > 0 && passwordLen < 8
                    ? t("chars_count", { count: passwordLen })
                    : t("min_8_chars")}
                </p>
            }
          </div>

          {/* Email (optional) */}
          <div className="space-y-1.5">
            <Label>{t("email_optional")}</Label>
            <Input
              type="email"
              placeholder="jane.smith@company.com"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              className={cn(fieldErrors.email && "border-destructive focus-visible:ring-destructive/30")}
            />
            <FieldError msg={fieldErrors.email} />
          </div>

          {/* Role + Job title */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("role")}</Label>
              <RoleSelect value={form.role} onChange={(v) => set("role", v)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("position_optional")}</Label>
              <Input placeholder={t("position_placeholder")} value={form.position} onChange={(e) => set("position", e.target.value)} />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>{t("custom_role")}</Label>
              <CustomRoleCombobox value={form.customRoleId} onChange={(v) => set("customRoleId", v)} />
            </div>
          </div>

          {/* Departments */}
          <div className="space-y-1.5">
            <Label>{t("departments_optional")}</Label>
            <DepartmentMultiSelect
              departments={departments ?? []}
              value={form.departmentIds}
              onChange={(ids) => set("departmentIds", ids)}
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="flex items-center gap-1.5 cursor-pointer">
                <KeyRound className="w-3.5 h-3.5 text-amber-500" />
                {t("force_password_change")}
              </Label>
              <p className="text-xs text-muted-foreground">{t("force_password_change_desc")}</p>
            </div>
            <Switch checked={form.mustResetPassword} onCheckedChange={(v) => set("mustResetPassword", v)} />
          </div>

          {/* General API error banner */}
          {apiError && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
              <span className="mt-0.5 shrink-0">⚠</span>
              <span>{apiError}</span>
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={handleClose}>{t("cancel")}</Button>
            <Button
              onClick={handleCreate}
              disabled={adminCreateUser.isPending}
              className={cn(hasFieldErrors && "opacity-80")}
            >
              {adminCreateUser.isPending ? t("creating") : t("create_user_directly")}
            </Button>
          </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit employee dialog ─────────────────────────────────────────────────────

function EditUserDialog({ user, open, onClose }: { user: any; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const initialDeptIds: number[] = user?.departments?.length
    ? user.departments.map((d: any) => d.id)
    : user?.departmentId ? [Number(user.departmentId)] : [];

  const [form, setForm] = useState({
    firstName: user?.firstName ?? "",
    lastName: user?.lastName ?? "",
    employeeNumber: user?.employeeNumber ?? "",
    email: user?.email ?? "",
    fullName: user?.fullName ?? "",
    role: (user?.role ?? "member") as Role,
    customRoleId: user?.customRoleId ? String(user.customRoleId) : "__none__",
    position: user?.position ?? "",
    phoneNumber: user?.phoneNumber ?? "",
    extensionNumber: user?.extensionNumber ?? "",
    lineManagerId: user?.lineManagerId ? String(user.lineManagerId) : "",
    departmentIds: initialDeptIds,
    employmentStatus: user?.employmentStatus ?? "active",
    status: user?.status ?? "active",
    languagePreference: user?.languagePreference ?? "",
    timeZone: user?.timeZone ?? "",
    mustResetPassword: user?.mustResetPassword ?? false,
  });
  const [confirmMultiDept, setConfirmMultiDept] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [showPasswordReset, setShowPasswordReset] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const { toast } = useToast();
  const updateUser = useUpdateUser();
  const resetPassword = useAdminResetUserPassword();
  const deleteUser = useDeleteUser();
  const { data: departments } = useListDepartments({});
  const { data: allUsers } = useListUsers({});
  const queryClient = useQueryClient();

  const set = (key: string, val: any) => setForm(f => ({ ...f, [key]: val }));

  const doSave = () => {
    const firstName = form.firstName.trim();
    const lastName = form.lastName.trim();
    const computedFullName = firstName && lastName ? `${firstName} ${lastName}` : form.fullName;
    updateUser.mutate({
      id: user.id,
      data: {
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        fullName: computedFullName || undefined,
        employeeNumber: form.employeeNumber || null,
        email: form.email || null,
        role: form.role,
        customRoleId: form.customRoleId !== "__none__" ? Number(form.customRoleId) : null,
        position: form.position || null,
        phoneNumber: form.phoneNumber || null,
        extensionNumber: form.extensionNumber || null,
        lineManagerId: form.lineManagerId ? Number(form.lineManagerId) : null,
        departmentIds: form.departmentIds,
        employmentStatus: form.employmentStatus as "active" | "on_leave" | "terminated",
        status: form.status as "active" | "inactive",
        languagePreference: form.languagePreference || null,
        timeZone: form.timeZone || null,
        mustResetPassword: form.mustResetPassword,
      } as any
    }, {
      onSuccess: () => {
        toast({ title: t("user_updated") });
        queryClient.invalidateQueries({ queryKey: ["/api/users"] });
        onClose();
      },
      onError: (err: any) => {
        toast({ title: t("error"), description: err?.response?.data?.error, variant: "destructive" });
      },
    });
  };

  const handleSave = () => {
    if (form.departmentIds.length > 1) { setConfirmMultiDept(true); return; }
    doSave();
  };

  const handleResetPassword = () => {
    if (!newPassword || newPassword.length < 8) {
      toast({ title: t("password_too_short"), description: t("password_too_short_desc"), variant: "destructive" });
      return;
    }
    resetPassword.mutate({ id: user.id, data: { password: newPassword } }, {
      onSuccess: () => {
        toast({ title: t("password_reset"), description: t("password_reset_desc", { name: user.fullName }) });
        setNewPassword(""); setShowPasswordReset(false);
      },
      onError: (err: any) => {
        toast({ title: t("error"), description: err?.response?.data?.error, variant: "destructive" });
      },
    });
  };

  const handleDelete = () => {
    deleteUser.mutate({ id: user.id }, {
      onSuccess: () => {
        toast({ title: t("user_deleted"), description: t("user_deleted_desc", { name: user.fullName }) });
        queryClient.invalidateQueries({ queryKey: ["/api/users"] });
        onClose();
      },
      onError: (err: any) => {
        toast({ title: t("error"), description: err?.response?.data?.error, variant: "destructive" });
        setDeleteConfirmOpen(false);
      },
    });
  };

  const otherUsers = (allUsers ?? []).filter(u => u.id !== user.id);
  if (!user) return null;

  return (
    <>
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCog className="w-4 h-4" />
            {t("edit_user_title", { name: user.fullName })}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* User identity card */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
            <img
              src={user.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(user.fullName)}`}
              className="w-10 h-10 rounded-full border"
              alt={user.fullName}
            />
            <div>
              <p className="font-medium text-sm">{user.fullName}</p>
              <p className="text-xs text-muted-foreground font-mono">
                {user.employeeNumber ? `#${user.employeeNumber}` : (user.email ?? "-")}
              </p>
            </div>
          </div>

          {/* Basic info */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">{t("basic_info")}</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("first_name")}</Label>
                <Input value={form.firstName} onChange={(e) => set("firstName", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("last_name")}</Label>
                <Input value={form.lastName} onChange={(e) => set("lastName", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  <Hash className="w-3.5 h-3.5 text-muted-foreground" />
                  {t("employee_number")} <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={form.employeeNumber}
                  onChange={(e) => set("employeeNumber", e.target.value)}
                  placeholder="EMP-001"
                />
                <p className="text-xs text-muted-foreground">{t("employee_number_hint")}</p>
              </div>
              <div className="space-y-1.5">
                <Label>{t("email_optional")}</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="email@company.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("job_title")}</Label>
                <Input placeholder={t("position_placeholder")} value={form.position} onChange={(e) => set("position", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("departments_optional")}</Label>
                <DepartmentMultiSelect
                  departments={departments ?? []}
                  value={form.departmentIds}
                  onChange={(ids) => set("departmentIds", ids)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("line_manager")}</Label>
                <Select value={form.lineManagerId} onValueChange={(v) => set("lineManagerId", v === "__none__" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder={t("no_line_manager")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__"><span className="text-muted-foreground">{t("none")}</span></SelectItem>
                    {otherUsers.map(u => (
                      <SelectItem key={u.id} value={String(u.id)}>{u.fullName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <Separator />

          {/* Contact */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">{t("contact_section")}</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("phone_number")}</Label>
                <Input placeholder="+966 5x xxx xxxx" value={form.phoneNumber} onChange={(e) => set("phoneNumber", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("extension")}</Label>
                <Input placeholder="e.g. 1024" value={form.extensionNumber} onChange={(e) => set("extensionNumber", e.target.value)} />
              </div>
            </div>
          </div>

          <Separator />

          {/* Preferences */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">{t("preferences_section")}</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("language")}</Label>
                <Select value={form.languagePreference || "__none__"} onValueChange={(v) => set("languagePreference", v === "__none__" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder={t("system_default")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__"><span className="text-muted-foreground">{t("system_default")}</span></SelectItem>
                    <SelectItem value="en">{t("lang_en")}</SelectItem>
                    <SelectItem value="ar">{t("lang_ar")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("timezone")}</Label>
                <Input placeholder="e.g. Asia/Riyadh" value={form.timeZone} onChange={(e) => set("timeZone", e.target.value)} />
              </div>
            </div>
          </div>

          <Separator />

          {/* Account */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">{t("account_section")}</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("role")}</Label>
                <RoleSelect value={form.role} onChange={(v) => set("role", v)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("custom_role")}</Label>
                <CustomRoleCombobox value={form.customRoleId} onChange={(v) => set("customRoleId", v)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("account_status")}</Label>
                <Select value={form.status} onValueChange={(v) => set("status", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">
                      <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-500" /> {t("emp_active")}</div>
                    </SelectItem>
                    <SelectItem value="inactive">
                      <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-zinc-400" /> {t("status_inactive")}</div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>{t("employment_status")}</Label>
                <Select value={form.employmentStatus} onValueChange={(v) => set("employmentStatus", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">{t("emp_active")}</SelectItem>
                    <SelectItem value="on_leave">{t("emp_on_leave")}</SelectItem>
                    <SelectItem value="terminated">{t("emp_terminated")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-between mt-3 py-2">
              <div className="space-y-0.5">
                <Label className="flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-amber-500" />
                  {t("require_password_change")}
                </Label>
                <p className="text-xs text-muted-foreground">{t("require_password_change_desc")}</p>
              </div>
              <Switch checked={form.mustResetPassword} onCheckedChange={(v) => set("mustResetPassword", v)} />
            </div>
          </div>

          <Separator />

          {/* Password reset */}
          <div>
            {!showPasswordReset ? (
              <Button variant="outline" size="sm" className="w-full" onClick={() => setShowPasswordReset(true)}>
                <KeyRound className="w-3.5 h-3.5 me-1.5" /> {t("reset_password")}
              </Button>
            ) : (
              <div className="space-y-3 p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
                <p className="text-xs font-medium text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5" /> {t("set_new_password", { name: user.fullName })}
                </p>
                <div className="flex gap-2">
                  <Input type="password" placeholder={t("new_password_placeholder")} value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleResetPassword()} className="flex-1" />
                  <Button size="sm" onClick={handleResetPassword} disabled={!newPassword || resetPassword.isPending}>
                    {resetPassword.isPending ? t("saving") : t("set_btn")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setShowPasswordReset(false); setNewPassword(""); }}>{t("cancel")}</Button>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-between gap-2">
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setDeleteConfirmOpen(true)}
            disabled={deleteUser.isPending}
            className="w-full sm:w-auto"
          >
            <Trash2 className="w-3.5 h-3.5 me-1.5" />
            {t("delete_user")}
          </Button>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={onClose}>{t("cancel")}</Button>
            <Button onClick={handleSave} disabled={updateUser.isPending}>
              {updateUser.isPending ? t("saving") : t("save_changes")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("delete_user_confirm_title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("delete_user_confirm_desc", { name: user.fullName })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteUser.isPending}>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={deleteUser.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleteUser.isPending ? t("deleting") : t("delete_user_btn")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <MultiDeptConfirmDialog
      open={confirmMultiDept}
      deptNames={form.departmentIds.map(id => departments?.find(d => d.id === id)?.name).filter((n): n is string => Boolean(n))}
      onConfirm={() => { setConfirmMultiDept(false); doSave(); }}
      onCancel={() => setConfirmMultiDept(false)}
    />
    </>
  );
}

// ─── Custom role searchable combobox ─────────────────────────────────────────

function CustomRoleCombobox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { data: roles = [], isLoading } = useListWorkspaceRoles({});

  const filtered = roles.filter((r: any) =>
    r.name.toLowerCase().includes(search.toLowerCase())
  );

  const selected = roles.find((r: any) => String(r.id) === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal h-9 px-3"
        >
          {selected ? (
            <div className="flex items-center gap-2 min-w-0">
              {selected.color && (
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: selected.color }} />
              )}
              <span className="truncate">{selected.name}</span>
            </div>
          ) : (
            <span className="text-muted-foreground">{t("no_custom_role")}</span>
          )}
          <ChevronsUpDown className="ms-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={t("search_placeholder")}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {isLoading ? (
              <CommandEmpty>{t("loading")}</CommandEmpty>
            ) : filtered.length === 0 && search === "" ? (
              <div className="px-3 py-6 text-center">
                <ShieldCheck className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground mb-1">{t("no_roles_yet")}</p>
                <Link href="/roles" onClick={() => setOpen(false)}>
                  <span className="text-xs text-primary hover:underline cursor-pointer">{t("go_create_roles")}</span>
                </Link>
              </div>
            ) : filtered.length === 0 ? (
              <CommandEmpty>{t("no_results")}</CommandEmpty>
            ) : (
              <CommandGroup>
                {value !== "__none__" && (
                  <CommandItem
                    value="__none__"
                    onSelect={() => { onChange("__none__"); setOpen(false); setSearch(""); }}
                    className="text-muted-foreground"
                  >
                    <span className="w-2 h-2 rounded-full bg-muted flex-shrink-0" />
                    {t("no_custom_role")}
                  </CommandItem>
                )}
                {filtered.map((role: any) => (
                  <CommandItem
                    key={role.id}
                    value={String(role.id)}
                    onSelect={() => { onChange(String(role.id)); setOpen(false); setSearch(""); }}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {role.color && (
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: role.color }} />
                      )}
                      <span className="truncate">{role.name}</span>
                    </div>
                    {String(role.id) === value && (
                      <span className="ms-auto text-primary text-xs">✓</span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function RoleSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="admin">
          <div className="flex items-center gap-2"><ShieldCheck className="w-3.5 h-3.5 text-primary" /> {t("role_admin")}</div>
        </SelectItem>
        <SelectItem value="manager">
          <div className="flex items-center gap-2"><UserCog className="w-3.5 h-3.5 text-blue-500" /> {t("role_manager")}</div>
        </SelectItem>
        <SelectItem value="member">
          <div className="flex items-center gap-2"><UserPlus className="w-3.5 h-3.5 text-muted-foreground" /> {t("role_member")}</div>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

function DepartmentMultiSelect({
  departments, value, onChange,
}: {
  departments: { id: number; name: string }[];
  value: number[];
  onChange: (ids: number[]) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const toggle = (id: number) => {
    onChange(value.includes(id) ? value.filter(v => v !== id) : [...value, id]);
  };

  const label = value.length === 0
    ? <span className="text-muted-foreground">{t("no_members_selected")}</span>
    : value.length === 1
      ? departments.find(d => d.id === value[0])?.name
      : t("depts_selected", { count: value.length });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between font-normal h-9 px-3">
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="w-4 h-4 opacity-50 shrink-0 ms-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
        <Command>
          <CommandInput placeholder={t("search")} />
          <CommandList>
            <CommandEmpty>{t("no_departments_found", { defaultValue: "No departments found." })}</CommandEmpty>
            <CommandGroup>
              {departments.map(dept => (
                <CommandItem
                  key={dept.id}
                  value={dept.name}
                  onSelect={() => toggle(dept.id)}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <Checkbox
                    checked={value.includes(dept.id)}
                    className="shrink-0"
                    onCheckedChange={() => toggle(dept.id)}
                  />
                  <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate">{dept.name}</span>
                  {value[0] === dept.id && value.length > 0 && (
                    <Badge variant="outline" className="ms-auto text-[10px] px-1 py-0 shrink-0">P</Badge>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        {value.length > 0 && (
          <div className="border-t p-2 text-xs text-muted-foreground">
            {t("first_is_primary", { defaultValue: "First selected is the primary department" })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function MultiDeptConfirmDialog({ open, deptNames, onConfirm, onCancel }: {
  open: boolean; deptNames: string[]; onConfirm: () => void; onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("confirm")}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <ul className="space-y-1">
                {deptNames.map((name, i) => (
                  <li key={name} className="flex items-center gap-2 text-sm">
                    <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span>{name}</span>
                    {i === 0 && <Badge variant="outline" className="text-[10px] px-1 py-0">Primary</Badge>}
                  </li>
                ))}
              </ul>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{t("confirm")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Invitations panel ────────────────────────────────────────────────────────

function InvitationsPanel() {
  const { t } = useTranslation();
  const { data: invitations, isLoading } = useListInvitations({});
  const cancelInvitation = useCancelInvitation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleCancel = (id: number) => {
    cancelInvitation.mutate({ id }, {
      onSuccess: () => {
        toast({ title: t("cancel_invitation") });
        queryClient.invalidateQueries({ queryKey: ["/api/invitations"] });
      },
    });
  };

  const pending = invitations?.filter(i => i.status === "pending") ?? [];
  if (isLoading) return <div className="p-4 text-sm text-muted-foreground">{t("loading")}</div>;
  if (pending.length === 0) return <div className="p-6 text-center text-sm text-muted-foreground">{t("no_pending_invitations")}</div>;

  return (
    <div className="divide-y divide-border">
      {pending.map((inv) => (
        <div key={inv.id} className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center">
              <Mail className="w-4 h-4 text-amber-600" />
            </div>
            <div>
              <p className="text-sm font-medium">{inv.email}</p>
              <p className="text-xs text-muted-foreground capitalize">
                {inv.role}
                {inv.invitedByName && <> · {inv.invitedByName}</>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-amber-600 border-amber-200 bg-amber-50">{t("status_pending")}</Badge>
            <Button variant="ghost" size="sm" onClick={() => handleCancel(inv.id)} disabled={cancelInvitation.isPending}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Role badge ───────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: string }) {
  const { t } = useTranslation();
  if (role === "admin" || role === "super_admin") {
    return <Badge variant="secondary" className="text-[10px] px-1.5 py-0 capitalize bg-primary/10 text-primary border-0">{t("role_admin")}</Badge>;
  }
  if (role === "manager") {
    return <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-blue-600 border-blue-200">{t("role_manager")}</Badge>;
  }
  return null;
}

// ─── Employee card ────────────────────────────────────────────────────────────

function EmployeeCard({ user, isAdmin, currentUserId, onEdit }: {
  user: any;
  isAdmin: boolean;
  currentUserId?: number;
  onEdit: (u: any) => void;
}) {
  const { t } = useTranslation();
  const isCurrentUser = user.id === currentUserId;
  const primaryDept = user.departments?.find((d: any) => d.isPrimary) ?? user.departments?.[0];
  const extraDepts = user.departments ? user.departments.length - 1 : 0;

  return (
    <div
      className={cn(
        "group relative bg-card border border-border rounded-xl p-4 transition-all duration-200",
        "hover:shadow-md hover:border-border/80",
        isAdmin && "cursor-pointer",
        user.status === "inactive" && "opacity-60"
      )}
      onClick={() => isAdmin && onEdit(user)}
    >
      {/* Edit icon overlay */}
      {isAdmin && (
        <div className="absolute top-3 end-3 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="w-6 h-6 rounded-md bg-muted flex items-center justify-center">
            <Pencil className="w-3 h-3 text-muted-foreground" />
          </div>
        </div>
      )}

      {/* Must reset password indicator */}
      {user.mustResetPassword && (
        <div className="absolute top-3 start-3">
          <span className="w-5 h-5 bg-amber-400 rounded-full border-2 border-background flex items-center justify-center">
            <KeyRound className="w-2.5 h-2.5 text-white" />
          </span>
        </div>
      )}

      {/* Avatar + status */}
      <div className="flex flex-col items-center text-center mb-3">
        <div className="relative mb-2">
          <img
            src={user.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(user.fullName)}`}
            alt={user.fullName}
            className="w-14 h-14 rounded-full border-2 border-border"
          />
          <span className={cn(
            "absolute bottom-0 end-0 w-3.5 h-3.5 rounded-full border-2 border-background",
            user.status === "active" ? "bg-emerald-500" : "bg-zinc-400"
          )} />
        </div>

        {/* Name */}
        <div className="flex items-center gap-1.5 flex-wrap justify-center">
          <p className="font-semibold text-sm leading-tight">{user.fullName}</p>
          {isCurrentUser && (
            <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">You</Badge>
          )}
        </div>

        {/* Role badge */}
        <div className="mt-1 flex items-center justify-center flex-wrap gap-1">
          {user.role !== "member" && <RoleBadge role={user.role} />}
          {user.customRoleName && (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 border-0"
              style={user.customRoleColor
                ? { background: `${user.customRoleColor}22`, color: user.customRoleColor }
                : undefined}
            >
              {user.customRoleName}
            </Badge>
          )}
        </div>
      </div>

      {/* Employee number */}
      {user.employeeNumber && (
        <div className="flex items-center justify-center gap-1 mb-2">
          <Hash className="w-3 h-3 text-muted-foreground" />
          <span className="text-xs font-mono text-muted-foreground">{user.employeeNumber}</span>
        </div>
      )}

      {/* Job title */}
      {user.position && (
        <p className="text-xs text-center text-muted-foreground truncate mb-2">{user.position}</p>
      )}

      {/* Department(s) */}
      {primaryDept ? (
        <div className="flex items-center justify-center gap-1 flex-wrap">
          <div className="flex items-center gap-1 bg-muted/60 rounded-full px-2 py-0.5">
            <Building2 className="w-3 h-3 text-muted-foreground" />
            <span className="text-xs truncate max-w-[100px]">{primaryDept.name}</span>
          </div>
          {extraDepts > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5">+{extraDepts}</Badge>
          )}
        </div>
      ) : (
        <p className="text-xs text-center text-muted-foreground/50">{t("no_dept")}</p>
      )}
    </div>
  );
}

// ─── Employee directory grid ──────────────────────────────────────────────────

function EmployeeDirectory({ users, isLoading, isAdmin, currentUserId }: {
  users: any[];
  isLoading: boolean;
  isAdmin: boolean;
  currentUserId?: number;
}) {
  const { t } = useTranslation();
  const [editUser, setEditUser] = useState<any | null>(null);

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="bg-card border border-border rounded-xl p-4 space-y-3">
            <Skeleton className="w-14 h-14 rounded-full mx-auto" />
            <Skeleton className="h-3.5 w-3/4 mx-auto" />
            <Skeleton className="h-3 w-1/2 mx-auto" />
          </div>
        ))}
      </div>
    );
  }

  if (users.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Users className="w-10 h-10 text-muted-foreground/30 mb-3" />
        <p className="text-muted-foreground">{t("no_users_found")}</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        {users.map(user => (
          <EmployeeCard
            key={user.id}
            user={user}
            isAdmin={isAdmin}
            currentUserId={currentUserId}
            onEdit={setEditUser}
          />
        ))}
      </div>

      {editUser && (
        <EditUserDialog
          user={editUser}
          open={!!editUser}
          onClose={() => setEditUser(null)}
        />
      )}
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function UsersPage() {
  const { t } = useTranslation();
  const { data: currentUser } = useGetMe();
  const { data: users, isLoading } = useListUsers({});
  const { data: departments } = useListDepartments({});
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState("all");
  const [filterDept, setFilterDept] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const isAdmin = currentUser?.role === "admin" || currentUser?.role === "super_admin";

  const filteredUsers = useMemo(() => {
    if (!users) return [];
    const q = search.toLowerCase();
    return users.filter(u => {
      const matchSearch = !q
        || u.fullName.toLowerCase().includes(q)
        || (u.employeeNumber ?? "").toLowerCase().includes(q)
        || (u.email ?? "").toLowerCase().includes(q)
        || (u.position ?? "").toLowerCase().includes(q);
      const matchRole = filterRole === "all" || u.role === filterRole;
      const matchDept = filterDept === "all"
        || u.departments?.some((d: any) => String(d.id) === filterDept)
        || (u.departments?.length === 0 && filterDept === "none");
      const matchStatus = filterStatus === "all" || u.status === filterStatus;
      return matchSearch && matchRole && matchDept && matchStatus;
    });
  }, [users, search, filterRole, filterDept, filterStatus]);

  const hasActiveFilters = filterRole !== "all" || filterDept !== "all" || filterStatus !== "all" || search;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{t("users")}</h2>
          <p className="text-muted-foreground">{t("users_subtitle")}</p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setInviteOpen(true)}>
              <Mail className="w-4 h-4 me-1.5" /> {t("invite_by_email")}
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4 me-1.5" /> {t("create_user_directly")}
            </Button>
          </div>
        )}
      </div>

      {isAdmin ? (
        <Tabs defaultValue="users">
          <TabsList>
            <TabsTrigger value="users">
              <Users className="w-3.5 h-3.5 me-1.5" /> {t("tabs_users")}
            </TabsTrigger>
            <TabsTrigger value="invitations">
              <Mail className="w-3.5 h-3.5 me-1.5" /> {t("tabs_invitations")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="mt-4 space-y-4">
            {/* Search + filters bar */}
            <div className="flex flex-wrap items-center gap-2 bg-card p-3 rounded-lg border shadow-sm">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder={t("search_users")}
                  className="ps-9 bg-background border-none focus-visible:ring-0 h-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <Select value={filterRole} onValueChange={setFilterRole}>
                <SelectTrigger className="w-36 h-9 border-none bg-muted/50">
                  <SelectValue placeholder={t("filter_all_roles")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("filter_all_roles")}</SelectItem>
                  <SelectItem value="admin">{t("role_admin")}</SelectItem>
                  <SelectItem value="manager">{t("role_manager")}</SelectItem>
                  <SelectItem value="member">{t("role_member")}</SelectItem>
                </SelectContent>
              </Select>

              <Select value={filterDept} onValueChange={setFilterDept}>
                <SelectTrigger className="w-40 h-9 border-none bg-muted/50">
                  <SelectValue placeholder={t("filter_all_depts")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("filter_all_depts")}</SelectItem>
                  {departments?.map(d => (
                    <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-36 h-9 border-none bg-muted/50">
                  <SelectValue placeholder={t("filter_all_status")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("filter_all_status")}</SelectItem>
                  <SelectItem value="active">{t("status_active")}</SelectItem>
                  <SelectItem value="inactive">{t("status_inactive")}</SelectItem>
                </SelectContent>
              </Select>

              {hasActiveFilters && (
                <Button
                  variant="ghost" size="sm"
                  className="h-9 text-xs text-muted-foreground"
                  onClick={() => { setSearch(""); setFilterRole("all"); setFilterDept("all"); setFilterStatus("all"); }}
                >
                  {t("clear")}
                </Button>
              )}

              <div className="ms-auto text-xs text-muted-foreground hidden sm:block">
                {filteredUsers.length} / {users?.length ?? 0}
              </div>
            </div>

            <EmployeeDirectory
              users={filteredUsers}
              isLoading={isLoading}
              isAdmin={isAdmin}
              currentUserId={currentUser?.id}
            />
          </TabsContent>

          <TabsContent value="invitations" className="mt-4">
            <Card className="border-border shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t("pending_invitations")}</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <InvitationsPanel />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      ) : (
        <div className="space-y-4">
          {/* Search bar for non-admins */}
          <div className="flex items-center gap-2 bg-card p-3 rounded-lg border shadow-sm">
            <div className="relative flex-1">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("search_users")}
                className="ps-9 bg-background border-none focus-visible:ring-0"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <EmployeeDirectory
            users={filteredUsers}
            isLoading={isLoading}
            isAdmin={false}
            currentUserId={currentUser?.id}
          />
        </div>
      )}

      <InviteUserDialog open={inviteOpen} onClose={() => setInviteOpen(false)} />
      <CreateUserDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
