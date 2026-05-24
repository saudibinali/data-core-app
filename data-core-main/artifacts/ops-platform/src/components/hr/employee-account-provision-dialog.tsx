import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useListWorkspaceRoles } from "@workspace/api-client-react";
import { useApiFetch } from "@/hooks/use-api-fetch";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Search, UserCheck, KeyRound, Building2, Briefcase } from "lucide-react";
import { cn } from "@/lib/utils";

type Role = "admin" | "manager" | "member";

export interface EmployeeProvisionPreview {
  employeeId: number;
  employeeNumber: string;
  fullName: string;
  email: string | null;
  phoneNumber: string | null;
  status: string;
  orgUnitName: string | null;
  jobTitleName: string | null;
  position: string | null;
  managerName: string | null;
  alreadyLinked: boolean;
  canProvision: boolean;
  blockReason: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  employeeId?: number;
  isAr?: boolean;
  onSuccess?: () => void;
  /** When true, render form only (no Dialog wrapper) for embedding in parent dialogs */
  embedded?: boolean;
}

export default function EmployeeAccountProvisionDialog({
  open, onClose, employeeId, isAr: isArProp, onSuccess, embedded = false,
}: Props) {
  const { i18n } = useTranslation();
  const isAr = isArProp ?? i18n.language.startsWith("ar");
  const apiFetch = useApiFetch();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: workspaceRoles = [] } = useListWorkspaceRoles({});

  const [employeeNumber, setEmployeeNumber] = useState("");
  const [preview, setPreview] = useState<EmployeeProvisionPreview | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [customRoleId, setCustomRoleId] = useState("__none__");
  const [mustResetPassword, setMustResetPassword] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setEmployeeNumber("");
    setPreview(null);
    setLookupError(null);
    setPassword("");
    setRole("member");
    setCustomRoleId("__none__");
    setMustResetPassword(true);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function loadPreviewById(id: number) {
    setLookingUp(true);
    setLookupError(null);
    try {
      const r = await apiFetch(`/api/hr/employees/${id}/provision-preview`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Lookup failed");
      setPreview(d);
    } catch (e: unknown) {
      setPreview(null);
      setLookupError(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setLookingUp(false);
    }
  }

  async function lookupByNumber() {
    const num = employeeNumber.trim();
    if (!num) return;
    setLookingUp(true);
    setLookupError(null);
    try {
      const r = await apiFetch(`/api/admin/users/employee-provision/lookup?employeeNumber=${encodeURIComponent(num)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Employee not found");
      setPreview(d);
    } catch (e: unknown) {
      setPreview(null);
      setLookupError(e instanceof Error ? e.message : "Employee not found");
    } finally {
      setLookingUp(false);
    }
  }

  useEffect(() => {
    if (open && employeeId) void loadPreviewById(employeeId);
    if (!open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, employeeId]);

  async function submit() {
    if (!password || password.length < 8) {
      toast({ title: isAr ? "كلمة المرور 8 أحرف على الأقل" : "Password must be at least 8 characters", variant: "destructive" });
      return;
    }
    if (!preview?.canProvision) return;

    setSubmitting(true);
    try {
      const url = employeeId
        ? `/api/hr/employees/${employeeId}/provision-account`
        : "/api/admin/users/from-employee";
      const body = employeeId
        ? { password, role, customRoleId: customRoleId !== "__none__" ? Number(customRoleId) : null, mustResetPassword }
        : {
            employeeNumber: preview.employeeNumber,
            password, role,
            customRoleId: customRoleId !== "__none__" ? Number(customRoleId) : null,
            mustResetPassword,
          };

      const r = await apiFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to create account");

      toast({
        title: isAr ? "تم إنشاء الحساب وربطه بالموظف" : "Account created and linked to employee",
        description: preview.fullName,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      onSuccess?.();
      handleClose();
    } catch (e: unknown) {
      toast({
        title: isAr ? "فشل إنشاء الحساب" : "Failed to create account",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = Boolean(preview?.canProvision && password.length >= 8);

  const formBody = (
    <>
      {!employeeId && (
        <div className="space-y-2">
          <Label>{isAr ? "الرقم الوظيفي" : "Employee number"}</Label>
          <div className="flex gap-2">
            <Input
              value={employeeNumber}
              onChange={(e) => { setEmployeeNumber(e.target.value); setPreview(null); setLookupError(null); }}
              placeholder={isAr ? "مثال: EMP-0042" : "e.g. EMP-0042"}
              className="font-mono"
              onKeyDown={(e) => e.key === "Enter" && void lookupByNumber()}
            />
            <Button type="button" variant="outline" onClick={() => void lookupByNumber()} disabled={lookingUp || !employeeNumber.trim()}>
              {lookingUp ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            </Button>
          </div>
          {lookupError && <p className="text-xs text-destructive">{lookupError}</p>}
        </div>
      )}

      {lookingUp && !preview && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          {isAr ? "جاري تحميل بيانات الموظف..." : "Loading employee data..."}
        </div>
      )}

      {preview && (
        <div className={cn(
          "rounded-lg border p-4 space-y-2 text-sm",
          preview.canProvision ? "bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800" : "bg-destructive/5 border-destructive/30",
        )}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold">{preview.fullName}</p>
              <p className="text-xs font-mono text-muted-foreground">#{preview.employeeNumber}</p>
            </div>
            <Badge variant={preview.canProvision ? "secondary" : "destructive"}>{preview.status}</Badge>
          </div>
          {preview.email && <p className="text-xs text-muted-foreground">{preview.email}</p>}
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground pt-1">
            {preview.orgUnitName && (
              <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{preview.orgUnitName}</span>
            )}
            {(preview.jobTitleName || preview.position) && (
              <span className="flex items-center gap-1"><Briefcase className="w-3 h-3" />{preview.jobTitleName ?? preview.position}</span>
            )}
            {preview.managerName && <span>{isAr ? "المدير:" : "Manager:"} {preview.managerName}</span>}
          </div>
          {!preview.canProvision && preview.blockReason && (
            <p className="text-xs text-destructive pt-1">{preview.blockReason}</p>
          )}
        </div>
      )}

      {preview?.canProvision && (
        <>
          <div className="space-y-1.5">
            <Label>{isAr ? "كلمة المرور الأولية" : "Initial password"} <span className="text-destructive">*</span></Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={isAr ? "8 أحرف على الأقل" : "At least 8 characters"} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{isAr ? "دور المنصة" : "Platform role"}</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">{isAr ? "موظف" : "Member"}</SelectItem>
                  <SelectItem value="manager">{isAr ? "مدير" : "Manager"}</SelectItem>
                  <SelectItem value="admin">{isAr ? "مشرف" : "Admin"}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {workspaceRoles.length > 0 && (
              <div className="space-y-1.5">
                <Label>{isAr ? "دور مخصص" : "Custom role"}</Label>
                <Select value={customRoleId} onValueChange={setCustomRoleId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{isAr ? "بدون" : "None"}</SelectItem>
                    {workspaceRoles.map((r: { id: number; name: string }) => (
                      <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-amber-500" />
              <div>
                <p className="text-sm font-medium">{isAr ? "إجبار تغيير كلمة المرور" : "Force password change"}</p>
                <p className="text-xs text-muted-foreground">{isAr ? "عند أول تسجيل دخول" : "On first login"}</p>
              </div>
            </div>
            <Switch checked={mustResetPassword} onCheckedChange={setMustResetPassword} />
          </div>
        </>
      )}
    </>
  );

  const footer = (
    <>
      <Button variant="outline" onClick={handleClose}>{isAr ? "إلغاء" : "Cancel"}</Button>
      <Button onClick={() => void submit()} disabled={!canSubmit || submitting}>
        {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        {isAr ? "إنشاء الحساب" : "Create account"}
      </Button>
    </>
  );

  if (embedded) {
    if (!open) return null;
    return (
      <div className="space-y-4 py-1">
        {formBody}
        <DialogFooter className="pt-2">{footer}</DialogFooter>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-primary" />
            {isAr ? "إنشاء حساب لموظف حالي" : "Create account for existing employee"}
          </DialogTitle>
          <DialogDescription>
            {isAr
              ? "يتم استيراد بيانات الموظف من الموارد البشرية تلقائياً — أنت تحدد كلمة المرور والصلاحيات فقط."
              : "Employee data is imported from HR automatically — you only set password and permissions."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">{formBody}</div>

        <DialogFooter>{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
