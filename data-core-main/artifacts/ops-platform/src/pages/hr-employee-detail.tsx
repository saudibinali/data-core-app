import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiClient, useGetHrEmployee, useUpdateHrEmployee } from "@workspace/api-client-react";
import { fetchLeaveListBridge, type NormalizedLeaveRow } from "@/lib/leave-bridge";
import { usePermissions } from "@/hooks/use-permissions";
import { useToast } from "@/hooks/use-toast";
import { useApiFetch } from "@/hooks/use-api-fetch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ChevronLeft, Pencil, Save, X, User, Building2, Settings,
  FileText, Phone, Mail, MapPin, Calendar, Briefcase, Shield,
  Hash, History, StickyNote, Activity, GitBranch, Plane,
  FileBadge, Loader2, Plus, Trash2, CheckCircle2, XCircle,
  Clock, AlertCircle, Link2, Unlink,
} from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────────

const EMPLOYMENT_TYPE_COLORS: Record<string, string> = {
  full_time:  "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  part_time:  "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  contractor: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  intern:     "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  temporary:  "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
};
const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  full_time: "Full-time", part_time: "Part-time",
  contractor: "Contractor", intern: "Intern", temporary: "Temporary",
};
const STATUS_STYLES: Record<string, string> = {
  active:     "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border-0",
  on_leave:   "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border-0",
  suspended:  "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 border-0",
  terminated: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border-0",
  resigned:   "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 border-0",
};
const STATUS_LABELS: Record<string, { en: string; ar: string }> = {
  active:     { en: "Active",     ar: "نشط" },
  on_leave:   { en: "On Leave",   ar: "في إجازة" },
  suspended:  { en: "Suspended",  ar: "موقوف" },
  terminated: { en: "Terminated", ar: "منتهية خدمته" },
  resigned:   { en: "Resigned",   ar: "مستقيل" },
};

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
        <AlertCircle className="w-6 h-6 text-muted-foreground/50" />
      </div>
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
}

// ── Sub-resource hooks (raw fetch) ────────────────────────────────────────────

function useSubResource<T>(url: string, deps: unknown[]) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const apiFetch = useApiFetch();
  const reload = useCallback(() => {
    setLoading(true);
    apiFetch(url)
      .then(r => r.json())
      .then(d => { setData(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [url, apiFetch]);
  useEffect(() => { reload(); }, [reload, ...deps]);
  return { data, loading, reload };
}

// ── Employee ↔ user account (P-HCM2) ─────────────────────────────────────────

function EmployeeAccountCard({
  employeeId,
  isAr,
  canManage,
}: {
  employeeId: number;
  isAr: boolean;
  canManage: boolean;
}) {
  const apiFetch = useApiFetch();
  const { toast } = useToast();
  const [account, setAccount] = useState<{
    linked: boolean;
    userId: number | null;
    userEmail: string | null;
    userName: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<{ id: number; fullName: string; email?: string }[]>([]);
  const [pickUserId, setPickUserId] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    apiFetch(`/api/hr/employees/${employeeId}/account`)
      .then(r => r.json())
      .then(d => { setAccount(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [apiFetch, employeeId]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (!canManage || account?.linked) return;
    apiFetch("/api/users")
      .then(r => r.json())
      .then(d => setUsers(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [canManage, account?.linked, apiFetch]);

  async function linkUser() {
    const uid = parseInt(pickUserId, 10);
    if (!uid) return;
    setBusy(true);
    try {
      const r = await apiFetch(`/api/hr/employees/${employeeId}/link-user`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: uid }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || "Link failed");
      }
      setAccount(await r.json());
      setPickUserId("");
      toast({ title: isAr ? "تم ربط الحساب" : "User linked" });
    } catch (e: unknown) {
      toast({
        title: isAr ? "فشل الربط" : "Link failed",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function unlinkUser() {
    setBusy(true);
    try {
      const r = await apiFetch(`/api/hr/employees/${employeeId}/link-user`, { method: "DELETE" });
      if (!r.ok) throw new Error("Unlink failed");
      setAccount(await r.json());
      toast({ title: isAr ? "تم فك الربط" : "User unlinked" });
    } catch {
      toast({ title: isAr ? "فشل فك الربط" : "Unlink failed", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Link2 className="w-4 h-4" />
          {isAr ? "حساب الدخول (Employee Central)" : "Login Account"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <Skeleton className="h-8 w-full" />
        ) : account?.linked ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{account.userName ?? `User #${account.userId}`}</p>
              {account.userEmail && (
                <p className="text-xs text-muted-foreground">{account.userEmail}</p>
              )}
              <Badge variant="secondary" className="mt-1">{isAr ? "مرتبط" : "Linked"}</Badge>
            </div>
            {canManage && (
              <Button variant="outline" size="sm" onClick={unlinkUser} disabled={busy}>
                <Unlink className="w-4 h-4 mr-2" />
                {isAr ? "فك الربط" : "Unlink"}
              </Button>
            )}
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {isAr
                ? "اربط ملف الموظف بمستخدم النظام لتفعيل الخدمة الذاتية والإجازات."
                : "Link this employee record to a workspace user for self-service and canonical leave."}
            </p>
            {canManage ? (
              <div className="flex flex-wrap gap-2 items-end">
                <div className="flex-1 min-w-[200px] space-y-1">
                  <Label className="text-xs">{isAr ? "مستخدم" : "User"}</Label>
                  <Select value={pickUserId} onValueChange={setPickUserId}>
                    <SelectTrigger><SelectValue placeholder={isAr ? "اختر مستخدم" : "Select user"} /></SelectTrigger>
                    <SelectContent>
                      {users.map(u => (
                        <SelectItem key={u.id} value={String(u.id)}>
                          {u.fullName}{u.email ? ` (${u.email})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button size="sm" onClick={linkUser} disabled={busy || !pickUserId}>
                  <Link2 className="w-4 h-4 mr-2" />
                  {isAr ? "ربط" : "Link"}
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{isAr ? "غير مرتبط" : "Not linked"}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function HrEmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const { hasPermission } = usePermissions();
  const { toast } = useToast();
  const isAdmin = hasPermission("admin") || hasPermission("hr.manage");

  const [editing, setEditing] = useState(false);
  const [edits, setEdits]     = useState<Record<string, any>>({});

  const { data: emp, isLoading, refetch } = useGetHrEmployee(
    Number(id),
    { query: { enabled: !!id, queryKey: ["hr-employee", id] } }
  );
  const updateMutation = useUpdateHrEmployee();

  const e = emp as any;

  function set(field: string, value: string) {
    setEdits(prev => ({ ...prev, [field]: value }));
  }
  function val(field: string) {
    return edits[field] !== undefined ? edits[field] : (e?.[field] ?? "");
  }
  function startEdit()  { setEdits({}); setEditing(true); }
  function cancelEdit() { setEdits({}); setEditing(false); }
  function saveEdit() {
    if (!Object.keys(edits).length) { setEditing(false); return; }
    updateMutation.mutate(
      { id: Number(id), data: edits },
      {
        onSuccess: () => {
          toast({ title: isAr ? "تم التحديث" : "Profile updated" });
          setEditing(false); setEdits({}); refetch();
        },
        onError: () => toast({ title: isAr ? "فشل التحديث" : "Update failed", variant: "destructive" }),
      }
    );
  }

  // Sub-resources
  const contracts     = useSubResource<any>(`/api/hr/employees/${id}/contracts`,       [id]);
  const documents     = useSubResource<any>(`/api/hr/employees/${id}/documents`,       [id]);
  const posHistory    = useSubResource<any>(`/api/hr/employees/${id}/position-history`,[id]);
  const notes         = useSubResource<any>(`/api/hr/employees/${id}/notes`,           [id]);
  const activity      = useSubResource<any>(`/api/hr/employees/${id}/activity`,        [id]);
  const customFields  = useSubResource<any>(`/api/hr/employees/${id}/custom-fields`,   [id]);

  // ── Loading / not found ───────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-10 w-48" />
        <Card><CardContent className="p-6"><Skeleton className="h-40 w-full" /></CardContent></Card>
      </div>
    );
  }
  if (!emp) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <User className="w-14 h-14 text-muted-foreground/30 mb-4" />
        <p className="text-lg font-medium text-muted-foreground">{isAr ? "الموظف غير موجود" : "Employee not found"}</p>
        <Link href="/hr/employees">
          <button className="mt-4 text-sm text-primary hover:underline">{isAr ? "العودة للقائمة" : "Back to employees"}</button>
        </Link>
      </div>
    );
  }

  const statusLabel = STATUS_LABELS[e.status];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3 flex-wrap">
        <Link href="/hr/employees">
          <button className="p-1 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground mt-1">
            <ChevronLeft className="w-5 h-5" />
          </button>
        </Link>

        <div className="flex items-start gap-4 flex-1 min-w-0">
          {e.avatarUrl ? (
            <img src={e.avatarUrl} alt={e.fullName} className="w-16 h-16 rounded-full border-2 border-border shrink-0 object-cover" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xl font-bold shrink-0 border-2 border-border">
              {initials(e.fullName)}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold truncate">{e.fullName}</h1>
            <div className="flex items-center gap-2 flex-wrap mt-0.5">
              {e.jobTitleName && <span className="text-sm text-muted-foreground">{e.jobTitleName}</span>}
              {!e.jobTitleName && e.position && <span className="text-sm text-muted-foreground">{e.position}</span>}
              {e.orgUnitName && (
                <><span className="text-muted-foreground/40">·</span>
                <span className="text-sm text-muted-foreground">{e.orgUnitName}</span></>
              )}
              {e.employmentType && (
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${EMPLOYMENT_TYPE_COLORS[e.employmentType] ?? "bg-muted"}`}>
                  {EMPLOYMENT_TYPE_LABELS[e.employmentType] ?? e.employmentType}
                </span>
              )}
              <Badge className={`${STATUS_STYLES[e.status] ?? "border-0"} text-xs`}>
                {statusLabel ? (isAr ? statusLabel.ar : statusLabel.en) : e.status}
              </Badge>
            </div>
            <div className="flex items-center gap-4 mt-1.5 flex-wrap">
              {e.employeeNumber && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground font-mono">
                  <Hash className="w-3 h-3" /> {e.employeeNumber}
                </span>
              )}
              {e.email && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Mail className="w-3 h-3" /> {e.email}
                </span>
              )}
              {e.phoneNumber && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Phone className="w-3 h-3" /> {e.phoneNumber}
                </span>
              )}
              {e.location && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="w-3 h-3" /> {e.location}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isAdmin && !editing && (
            <Button variant="outline" size="sm" onClick={startEdit}>
              <Pencil className="w-4 h-4 mr-2" />{isAr ? "تعديل" : "Edit"}
            </Button>
          )}
          {editing && (
            <>
              <Button variant="outline" size="sm" onClick={cancelEdit}>
                <X className="w-4 h-4 mr-2" />{isAr ? "إلغاء" : "Cancel"}
              </Button>
              <Button size="sm" onClick={saveEdit} disabled={updateMutation.isPending}>
                {updateMutation.isPending
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{isAr ? "حفظ..." : "Saving..."}</>
                  : <><Save className="w-4 h-4 mr-2" />{isAr ? "حفظ" : "Save"}</>}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="profile">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="profile"      className="text-xs"><User      className="w-3.5 h-3.5 mr-1.5" />{isAr ? "الملف الشخصي" : "Profile"}</TabsTrigger>
          <TabsTrigger value="org"          className="text-xs"><Building2 className="w-3.5 h-3.5 mr-1.5" />{isAr ? "الهيكل التنظيمي" : "Org Structure"}</TabsTrigger>
          <TabsTrigger value="contracts"    className="text-xs"><FileText  className="w-3.5 h-3.5 mr-1.5" />{isAr ? "العقود" : "Contracts"}</TabsTrigger>
          <TabsTrigger value="documents"    className="text-xs"><FileBadge className="w-3.5 h-3.5 mr-1.5" />{isAr ? "الوثائق" : "Documents"}</TabsTrigger>
          <TabsTrigger value="leaves"       className="text-xs"><Plane     className="w-3.5 h-3.5 mr-1.5" />{isAr ? "الإجازات" : "Leaves"}</TabsTrigger>
          <TabsTrigger value="movements"    className="text-xs"><GitBranch className="w-3.5 h-3.5 mr-1.5" />{isAr ? "الحركات الوظيفية" : "Job Movements"}</TabsTrigger>
          <TabsTrigger value="notes"        className="text-xs"><StickyNote className="w-3.5 h-3.5 mr-1.5" />{isAr ? "الملاحظات" : "Notes"}</TabsTrigger>
          <TabsTrigger value="custom"       className="text-xs"><Settings  className="w-3.5 h-3.5 mr-1.5" />{isAr ? "حقول مخصصة" : "Custom Fields"}</TabsTrigger>
          <TabsTrigger value="activity"     className="text-xs"><Activity  className="w-3.5 h-3.5 mr-1.5" />{isAr ? "سجل النشاط" : "Activity"}</TabsTrigger>
        </TabsList>

        {/* ── Profile ────────────────────────────────────────────────────── */}
        <TabsContent value="profile" className="space-y-4 mt-4">
          <EmployeeAccountCard employeeId={Number(id)} isAr={isAr} canManage={isAdmin} />
          <Card>
            <CardHeader><CardTitle className="text-base">{isAr ? "المعلومات الشخصية" : "Personal Information"}</CardTitle></CardHeader>
            <CardContent>
              {editing ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[
                    { key: "fullName",       label: isAr ? "الاسم الكامل" : "Full Name", required: true },
                    { key: "firstName",      label: isAr ? "الاسم الأول" : "First Name" },
                    { key: "lastName",       label: isAr ? "الاسم الأخير" : "Last Name" },
                    { key: "email",          label: isAr ? "البريد الإلكتروني" : "Email", type: "email" },
                    { key: "phoneNumber",    label: isAr ? "رقم الهاتف" : "Phone", type: "tel" },
                    { key: "employeeNumber", label: isAr ? "الرقم الوظيفي" : "Employee #" },
                    { key: "nationality",    label: isAr ? "الجنسية" : "Nationality" },
                    { key: "dateOfBirth",    label: isAr ? "تاريخ الميلاد" : "Date of Birth", type: "date" },
                    { key: "nationalId",     label: isAr ? "رقم الهوية" : "National ID" },
                    { key: "passportNumber", label: isAr ? "رقم الجواز" : "Passport Number" },
                    { key: "address",        label: isAr ? "العنوان" : "Address", span: true },
                  ].map(f => (
                    <div key={f.key} className={f.span ? "sm:col-span-2" : ""}>
                      <div className="space-y-1.5">
                        <Label>{f.label}{f.required && <span className="text-destructive ml-0.5">*</span>}</Label>
                        <Input type={f.type ?? "text"} value={val(f.key)} onChange={ev => set(f.key, ev.target.value)} />
                      </div>
                    </div>
                  ))}
                  <div className="space-y-1.5">
                    <Label>{isAr ? "الجنس" : "Gender"}</Label>
                    <Select value={val("gender") || "__none"} onValueChange={v => set("gender", v === "__none" ? "" : v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">{isAr ? "غير محدد" : "Not specified"}</SelectItem>
                        <SelectItem value="male">{isAr ? "ذكر" : "Male"}</SelectItem>
                        <SelectItem value="female">{isAr ? "أنثى" : "Female"}</SelectItem>
                        <SelectItem value="other">{isAr ? "آخر" : "Other"}</SelectItem>
                        <SelectItem value="prefer_not_to_say">{isAr ? "أفضل عدم الإفصاح" : "Prefer not to say"}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>{isAr ? "الحالة الاجتماعية" : "Marital Status"}</Label>
                    <Select value={val("maritalStatus") || "__none"} onValueChange={v => set("maritalStatus", v === "__none" ? "" : v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">{isAr ? "غير محدد" : "Not specified"}</SelectItem>
                        <SelectItem value="single">{isAr ? "أعزب" : "Single"}</SelectItem>
                        <SelectItem value="married">{isAr ? "متزوج" : "Married"}</SelectItem>
                        <SelectItem value="divorced">{isAr ? "مطلق" : "Divorced"}</SelectItem>
                        <SelectItem value="widowed">{isAr ? "أرمل" : "Widowed"}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
                  <InfoRow label={isAr ? "الاسم الكامل" : "Full Name"} value={e.fullName} />
                  <InfoRow label={isAr ? "الرقم الوظيفي" : "Employee #"} value={e.employeeNumber ? `#${e.employeeNumber}` : null} />
                  <InfoRow label={isAr ? "البريد الإلكتروني" : "Email"} value={e.email} />
                  <InfoRow label={isAr ? "رقم الهاتف" : "Phone"} value={e.phoneNumber} />
                  <InfoRow label={isAr ? "الجنسية" : "Nationality"} value={e.nationality} />
                  <InfoRow label={isAr ? "الجنس" : "Gender"} value={e.gender} />
                  <InfoRow label={isAr ? "تاريخ الميلاد" : "Date of Birth"} value={e.dateOfBirth} />
                  <InfoRow label={isAr ? "الحالة الاجتماعية" : "Marital Status"} value={e.maritalStatus} />
                  <InfoRow label={isAr ? "رقم الهوية" : "National ID"} value={e.nationalId} />
                  <InfoRow label={isAr ? "رقم الجواز" : "Passport Number"} value={e.passportNumber} />
                  <InfoRow label={isAr ? "العنوان" : "Address"} value={e.address} />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Employment Data */}
          <Card>
            <CardHeader><CardTitle className="text-base">{isAr ? "بيانات التوظيف" : "Employment Data"}</CardTitle></CardHeader>
            <CardContent>
              {editing ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>{isAr ? "الحالة" : "Status"}</Label>
                    <Select value={val("status") || "active"} onValueChange={v => set("status", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">{isAr ? "نشط" : "Active"}</SelectItem>
                        <SelectItem value="on_leave">{isAr ? "في إجازة" : "On Leave"}</SelectItem>
                        <SelectItem value="suspended">{isAr ? "موقوف" : "Suspended"}</SelectItem>
                        <SelectItem value="terminated">{isAr ? "منتهية خدمته" : "Terminated"}</SelectItem>
                        <SelectItem value="resigned">{isAr ? "مستقيل" : "Resigned"}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>{isAr ? "نوع التوظيف" : "Employment Type"}</Label>
                    <Select value={val("employmentType") || "full_time"} onValueChange={v => set("employmentType", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="full_time">Full-time</SelectItem>
                        <SelectItem value="part_time">Part-time</SelectItem>
                        <SelectItem value="contractor">Contractor</SelectItem>
                        <SelectItem value="intern">Intern</SelectItem>
                        <SelectItem value="temporary">Temporary</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>{isAr ? "تاريخ الالتحاق" : "Hire Date"}</Label>
                    <Input type="date" value={val("hireDate")} onChange={ev => set("hireDate", ev.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{isAr ? "نهاية فترة التجربة" : "Probation End"}</Label>
                    <Input type="date" value={val("probationEndDate")} onChange={ev => set("probationEndDate", ev.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{isAr ? "تاريخ انتهاء العقد" : "Contract End"}</Label>
                    <Input type="date" value={val("endDate")} onChange={ev => set("endDate", ev.target.value)} />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
                  <InfoRow label={isAr ? "نوع التوظيف" : "Employment Type"} value={EMPLOYMENT_TYPE_LABELS[e.employmentType] ?? e.employmentType} />
                  <InfoRow label={isAr ? "تاريخ الالتحاق" : "Hire Date"} value={e.hireDate} />
                  <InfoRow label={isAr ? "نهاية فترة التجربة" : "Probation End"} value={e.probationEndDate} />
                  <InfoRow label={isAr ? "تاريخ انتهاء العقد" : "Contract End"} value={e.endDate} />
                  <InfoRow label={isAr ? "الشركة" : "Company"} value={e.company} />
                  <InfoRow label={isAr ? "الفرع" : "Branch"} value={e.branch} />
                  <InfoRow label={isAr ? "الموقع" : "Location"} value={e.location} />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Emergency Contact */}
          <Card>
            <CardHeader><CardTitle className="text-base">{isAr ? "جهة الطوارئ" : "Emergency Contact"}</CardTitle></CardHeader>
            <CardContent>
              {editing ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[
                    { key: "emergencyContactName",     label: isAr ? "الاسم" : "Name" },
                    { key: "emergencyContactPhone",    label: isAr ? "الهاتف" : "Phone", type: "tel" },
                    { key: "emergencyContactRelation", label: isAr ? "صلة القرابة" : "Relationship" },
                  ].map(f => (
                    <div key={f.key} className="space-y-1.5">
                      <Label>{f.label}</Label>
                      <Input type={f.type ?? "text"} value={val(f.key)} onChange={ev => set(f.key, ev.target.value)} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                  <InfoRow label={isAr ? "الاسم" : "Name"} value={e.emergencyContactName} />
                  <InfoRow label={isAr ? "الهاتف" : "Phone"} value={e.emergencyContactPhone} />
                  <InfoRow label={isAr ? "صلة القرابة" : "Relationship"} value={e.emergencyContactRelation} />
                  {!e.emergencyContactName && !e.emergencyContactPhone && (
                    <p className="text-sm text-muted-foreground col-span-2">{isAr ? "لم تُضف جهة طوارئ بعد" : "No emergency contact added yet"}</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Org Structure ───────────────────────────────────────────────── */}
        <TabsContent value="org" className="space-y-4 mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">{isAr ? "الموقع في الهيكل التنظيمي" : "Position in Org Structure"}</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
                <InfoRow label={isAr ? "الوحدة التنظيمية" : "Org Unit"} value={e.orgUnitName} />
                <InfoRow label={isAr ? "المسمى الوظيفي" : "Job Title"} value={e.jobTitleName ?? e.position} />
                <InfoRow label={isAr ? "الدرجة الوظيفية" : "Job Grade"} value={e.jobGradeName ? `${e.jobGradeName}${e.jobGradeCode ? ` (${e.jobGradeCode})` : ""}` : null} />
                <InfoRow label={isAr ? "المدير المباشر" : "Direct Manager"} value={e.managerName} />
                <InfoRow label={isAr ? "الشركة" : "Company"} value={e.company} />
                <InfoRow label={isAr ? "الفرع" : "Branch"} value={e.branch} />
                <InfoRow label={isAr ? "الموقع" : "Location"} value={e.location} />
              </div>
              {!e.orgUnitName && !e.jobTitleName && !e.managerName && (
                <p className="text-sm text-muted-foreground mt-4">{isAr ? "لم تُحدد بيانات الهيكل التنظيمي بعد" : "No org structure data assigned yet"}</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Contracts ───────────────────────────────────────────────────── */}
        <TabsContent value="contracts" className="mt-4">
          <ContractsTab empId={Number(id)} isAdmin={isAdmin} isAr={isAr} state={contracts} />
        </TabsContent>

        {/* ── Documents ───────────────────────────────────────────────────── */}
        <TabsContent value="documents" className="mt-4">
          <DocumentsTab empId={Number(id)} isAdmin={isAdmin} isAr={isAr} state={documents} />
        </TabsContent>

        {/* ── Leaves ──────────────────────────────────────────────────────── */}
        <TabsContent value="leaves" className="mt-4">
          <LeavesTab empId={Number(id)} isAdmin={isAdmin} isAr={isAr} />
        </TabsContent>

        {/* ── Job Movements ────────────────────────────────────────────────── */}
        <TabsContent value="movements" className="mt-4">
          <MovementsTab empId={Number(id)} isAdmin={isAdmin} isAr={isAr} state={posHistory} />
        </TabsContent>

        {/* ── Notes ───────────────────────────────────────────────────────── */}
        <TabsContent value="notes" className="mt-4">
          <NotesTab empId={Number(id)} isAdmin={isAdmin} isAr={isAr} state={notes} />
        </TabsContent>

        {/* ── Custom Fields ────────────────────────────────────────────────── */}
        <TabsContent value="custom" className="mt-4">
          <CustomFieldsTab empId={Number(id)} isAdmin={isAdmin} isAr={isAr} state={customFields} />
        </TabsContent>

        {/* ── Activity ────────────────────────────────────────────────────── */}
        <TabsContent value="activity" className="mt-4">
          <ActivityTab isAr={isAr} state={activity} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Sub-tab Components ────────────────────────────────────────────────────────

function ContractsTab({ empId, isAdmin, isAr, state }: { empId: number; isAdmin: boolean; isAr: boolean; state: any }) {
  const { toast } = useToast();
  const apiFetch = useApiFetch();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ contractType: "permanent", startDate: "", endDate: "", status: "active", salary: "", currency: "SAR", notes: "" });

  async function add() {
    try {
      const res = await apiFetch(`/api/hr/employees/${empId}/contracts`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Failed");
      toast({ title: isAr ? "تم إضافة العقد" : "Contract added" });
      setAdding(false);
      setForm({ contractType: "permanent", startDate: "", endDate: "", status: "active", salary: "", currency: "SAR", notes: "" });
      state.reload();
    } catch { toast({ title: isAr ? "فشل الإضافة" : "Failed", variant: "destructive" }); }
  }

  const CONTRACT_TYPE_LABELS: Record<string, string> = { permanent: "Permanent", fixed_term: "Fixed Term", probation: "Probation", freelance: "Freelance", part_time: "Part-time" };
  const STATUS_COLORS: Record<string, string> = { active: "text-emerald-600", expired: "text-zinc-500", draft: "text-blue-500", terminated: "text-red-500" };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-base">{isAr ? "العقود" : "Contracts"} ({state.data.length})</h3>
        {isAdmin && (
          <Button size="sm" variant="outline" onClick={() => setAdding(!adding)}>
            <Plus className="w-4 h-4 mr-2" />{isAr ? "إضافة عقد" : "Add Contract"}
          </Button>
        )}
      </div>

      {adding && (
        <Card className="border-primary/30">
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>{isAr ? "نوع العقد" : "Contract Type"}</Label>
                <Select value={form.contractType} onValueChange={v => setForm(f => ({ ...f, contractType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(CONTRACT_TYPE_LABELS).map(([k,v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>{isAr ? "الحالة" : "Status"}</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="expired">Expired</SelectItem>
                    <SelectItem value="terminated">Terminated</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>{isAr ? "تاريخ البدء" : "Start Date"}</Label><Input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>{isAr ? "تاريخ الانتهاء" : "End Date"}</Label><Input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>{isAr ? "الراتب" : "Salary"}</Label><Input value={form.salary} onChange={e => setForm(f => ({ ...f, salary: e.target.value }))} placeholder="e.g. 10,000" /></div>
              <div className="space-y-1.5"><Label>{isAr ? "العملة" : "Currency"}</Label><Input value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))} /></div>
              <div className="space-y-1.5 sm:col-span-2"><Label>{isAr ? "ملاحظات" : "Notes"}</Label><Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={() => setAdding(false)}>{isAr ? "إلغاء" : "Cancel"}</Button>
              <Button size="sm" onClick={add}>{isAr ? "حفظ" : "Save"}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {state.loading ? <Skeleton className="h-24 w-full" /> :
       state.data.length === 0 ? <EmptyState text={isAr ? "لا توجد عقود بعد" : "No contracts yet"} /> :
       state.data.map((c: any) => (
        <Card key={c.id}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">{CONTRACT_TYPE_LABELS[c.contractType] ?? c.contractType}</span>
                  <span className={`text-xs font-medium ${STATUS_COLORS[c.status] ?? ""}`}>{c.status}</span>
                </div>
                <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground flex-wrap">
                  {c.startDate && <span><Calendar className="w-3 h-3 inline mr-1" />{c.startDate}{c.endDate ? ` → ${c.endDate}` : ""}</span>}
                  {c.salary && <span>{c.salary} {c.currency}</span>}
                </div>
                {c.notes && <p className="text-xs text-muted-foreground mt-1">{c.notes}</p>}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function DocumentsTab({ empId, isAdmin, isAr, state }: { empId: number; isAdmin: boolean; isAr: boolean; state: any }) {
  const { toast } = useToast();
  const apiFetch = useApiFetch();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ documentType: "other", name: "", documentNumber: "", issueDate: "", expiryDate: "", notes: "" });

  const DOC_TYPES: Record<string, string> = {
    national_id: "National ID", passport: "Passport", iqama: "Iqama",
    driving_license: "Driving License", certificate: "Certificate", other: "Other",
  };

  async function add() {
    if (!form.name.trim()) { toast({ title: isAr ? "الاسم مطلوب" : "Name required", variant: "destructive" }); return; }
    try {
      const res = await apiFetch(`/api/hr/employees/${empId}/documents`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Failed");
      toast({ title: isAr ? "تم إضافة الوثيقة" : "Document added" });
      setAdding(false);
      setForm({ documentType: "other", name: "", documentNumber: "", issueDate: "", expiryDate: "", notes: "" });
      state.reload();
    } catch { toast({ title: isAr ? "فشل الإضافة" : "Failed", variant: "destructive" }); }
  }

  async function del(did: number) {
    await apiFetch(`/api/hr/employees/${empId}/documents/${did}`, { method: "DELETE" });
    toast({ title: isAr ? "تم الحذف" : "Deleted" });
    state.reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-base">{isAr ? "الوثائق الرسمية" : "Official Documents"} ({state.data.length})</h3>
        {isAdmin && <Button size="sm" variant="outline" onClick={() => setAdding(!adding)}><Plus className="w-4 h-4 mr-2" />{isAr ? "إضافة وثيقة" : "Add Document"}</Button>}
      </div>

      {adding && (
        <Card className="border-primary/30">
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>{isAr ? "نوع الوثيقة" : "Document Type"}</Label>
                <Select value={form.documentType} onValueChange={v => setForm(f => ({ ...f, documentType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(DOC_TYPES).map(([k,v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>{isAr ? "الاسم / الوصف" : "Name / Description"} *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>{isAr ? "رقم الوثيقة" : "Document Number"}</Label><Input value={form.documentNumber} onChange={e => setForm(f => ({ ...f, documentNumber: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>{isAr ? "تاريخ الإصدار" : "Issue Date"}</Label><Input type="date" value={form.issueDate} onChange={e => setForm(f => ({ ...f, issueDate: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>{isAr ? "تاريخ الانتهاء" : "Expiry Date"}</Label><Input type="date" value={form.expiryDate} onChange={e => setForm(f => ({ ...f, expiryDate: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>{isAr ? "ملاحظات" : "Notes"}</Label><Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={() => setAdding(false)}>{isAr ? "إلغاء" : "Cancel"}</Button>
              <Button size="sm" onClick={add}>{isAr ? "حفظ" : "Save"}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {state.loading ? <Skeleton className="h-24 w-full" /> :
       state.data.length === 0 ? <EmptyState text={isAr ? "لا توجد وثائق بعد" : "No documents yet"} /> :
       <div className="grid sm:grid-cols-2 gap-3">
         {state.data.map((d: any) => (
           <Card key={d.id}>
             <CardContent className="p-4">
               <div className="flex items-start justify-between gap-2">
                 <div>
                   <p className="font-semibold text-sm">{d.name}</p>
                   <p className="text-xs text-muted-foreground">{DOC_TYPES[d.documentType] ?? d.documentType}</p>
                   {d.documentNumber && <p className="text-xs font-mono text-muted-foreground mt-0.5"># {d.documentNumber}</p>}
                   {d.expiryDate && (
                     <p className={`text-xs mt-1 ${new Date(d.expiryDate) < new Date() ? "text-red-500" : "text-muted-foreground"}`}>
                       {isAr ? "ينتهي" : "Expires"}: {d.expiryDate}
                     </p>
                   )}
                 </div>
                 {isAdmin && (
                   <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0" onClick={() => del(d.id)}>
                     <Trash2 className="w-3.5 h-3.5" />
                   </Button>
                 )}
               </div>
             </CardContent>
           </Card>
         ))}
       </div>
      }
    </div>
  );
}

function LeavesTab({ empId, isAdmin, isAr }: { empId: number; isAdmin: boolean; isAr: boolean }) {
  const { toast } = useToast();
  const apiFetch = useApiFetch();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ leaveType: "annual", startDate: "", endDate: "", status: "pending", reason: "" });

  const leavesQ = useQuery({
    queryKey: ["/hr/leave-requests", "employee", empId],
    queryFn: async (): Promise<NormalizedLeaveRow[]> => {
      const canonical = await fetchLeaveListBridge(apiClient, { employeeId: empId });
      const res = await apiFetch(`/api/hr/employees/${empId}/leaves`);
      const legacyRows: NormalizedLeaveRow[] = res.ok
        ? ((await res.json()) as Record<string, unknown>[]).map((row) => ({
            id: Number(row.id),
            source: "legacy" as const,
            leaveType: String(row.leaveType ?? "annual"),
            startDate: String(row.startDate),
            endDate: String(row.endDate),
            daysCount: row.daysCount != null ? Number(row.daysCount) : null,
            status: String(row.status),
            reason: row.reason != null ? String(row.reason) : null,
          }))
        : [];
      return [...canonical, ...legacyRows].sort((a, b) => b.startDate.localeCompare(a.startDate));
    },
  });

  const LEAVE_TYPES: Record<string, { en: string; ar: string }> = {
    annual:    { en: "Annual",    ar: "سنوية" },
    sick:      { en: "Sick",      ar: "مرضية" },
    emergency: { en: "Emergency", ar: "طارئة" },
    maternity: { en: "Maternity", ar: "أمومة" },
    paternity: { en: "Paternity", ar: "أبوة" },
    unpaid:    { en: "Unpaid",    ar: "بدون راتب" },
    other:     { en: "Other",     ar: "أخرى" },
  };
  const STATUS_ICONS: Record<string, React.ReactNode> = {
    pending:            <Clock className="w-3.5 h-3.5 text-amber-500" />,
    pending_approval:     <Clock className="w-3.5 h-3.5 text-amber-500" />,
    approved:           <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />,
    rejected:           <XCircle className="w-3.5 h-3.5 text-red-500" />,
    withdrawn:          <XCircle className="w-3.5 h-3.5 text-zinc-400" />,
    cancelled:          <XCircle className="w-3.5 h-3.5 text-zinc-400" />,
  };

  const rows = leavesQ.data ?? [];

  async function add() {
    if (!form.startDate || !form.endDate) { toast({ title: isAr ? "التواريخ مطلوبة" : "Dates required", variant: "destructive" }); return; }
    try {
      const res = await apiFetch(`/api/hr/employees/${empId}/leaves`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Failed");
      toast({ title: isAr ? "تم إضافة الإجازة" : "Leave added" });
      setAdding(false);
      setForm({ leaveType: "annual", startDate: "", endDate: "", status: "pending", reason: "" });
      leavesQ.refetch();
    } catch { toast({ title: isAr ? "فشل الإضافة" : "Failed", variant: "destructive" }); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-base">{isAr ? "سجل الإجازات" : "Leave Records"} ({rows.length})</h3>
        {isAdmin && <Button size="sm" variant="outline" onClick={() => setAdding(!adding)}><Plus className="w-4 h-4 mr-2" />{isAr ? "إضافة إجازة" : "Add Leave"}</Button>}
      </div>

      {adding && (
        <Card className="border-primary/30">
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>{isAr ? "نوع الإجازة" : "Leave Type"}</Label>
                <Select value={form.leaveType} onValueChange={v => setForm(f => ({ ...f, leaveType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(LEAVE_TYPES).map(([k,v]) => <SelectItem key={k} value={k}>{isAr ? v.ar : v.en}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>{isAr ? "الحالة" : "Status"}</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">{isAr ? "قيد الانتظار" : "Pending"}</SelectItem>
                    <SelectItem value="approved">{isAr ? "موافق عليها" : "Approved"}</SelectItem>
                    <SelectItem value="rejected">{isAr ? "مرفوضة" : "Rejected"}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>{isAr ? "من" : "Start Date"} *</Label><Input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>{isAr ? "إلى" : "End Date"} *</Label><Input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} /></div>
              <div className="space-y-1.5 sm:col-span-2"><Label>{isAr ? "السبب" : "Reason"}</Label><Input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} /></div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={() => setAdding(false)}>{isAr ? "إلغاء" : "Cancel"}</Button>
              <Button size="sm" onClick={add}>{isAr ? "حفظ" : "Save"}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {leavesQ.isLoading ? <Skeleton className="h-24 w-full" /> :
       rows.length === 0 ? <EmptyState text={isAr ? "لا توجد إجازات مسجلة" : "No leave records yet"} /> :
       <div className="space-y-2">
         {rows.map((l) => (
           <Card key={`${l.source}-${l.id}`}>
             <CardContent className="p-4">
               <div className="flex items-center justify-between gap-3">
                 <div className="flex items-center gap-3">
                   {STATUS_ICONS[l.status] ?? <Clock className="w-3.5 h-3.5 text-muted-foreground" />}
                   <div>
                     <span className="font-medium text-sm">{isAr ? LEAVE_TYPES[l.leaveType]?.ar : LEAVE_TYPES[l.leaveType]?.en} {isAr ? "إجازة" : "Leave"}</span>
                     <div className="text-xs text-muted-foreground">{l.startDate} → {l.endDate}{l.daysCount ? ` · ${l.daysCount} ${isAr ? "أيام" : "days"}` : ""}</div>
                     {l.reason && <div className="text-xs text-muted-foreground mt-0.5">{l.reason}</div>}
                   </div>
                 </div>
                 <span className="text-xs text-muted-foreground capitalize">{l.status}</span>
               </div>
             </CardContent>
           </Card>
         ))}
       </div>
      }
    </div>
  );
}

function MovementsTab({ empId, isAdmin, isAr, state }: { empId: number; isAdmin: boolean; isAr: boolean; state: any }) {
  const { toast } = useToast();
  const apiFetch = useApiFetch();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ changeType: "promotion", effectiveDate: "", fromTitle: "", toTitle: "", fromGrade: "", toGrade: "", notes: "" });

  const CHANGE_TYPES: Record<string, { en: string; ar: string }> = {
    promotion:    { en: "Promotion",      ar: "ترقية" },
    transfer:     { en: "Transfer",       ar: "نقل" },
    demotion:     { en: "Demotion",       ar: "خفض درجة" },
    lateral:      { en: "Lateral Move",   ar: "حركة أفقية" },
    title_change: { en: "Title Change",   ar: "تغيير مسمى" },
    dept_change:  { en: "Dept. Change",   ar: "تغيير قسم" },
    other:        { en: "Other",          ar: "أخرى" },
  };

  async function add() {
    if (!form.effectiveDate) { toast({ title: isAr ? "التاريخ مطلوب" : "Date required", variant: "destructive" }); return; }
    try {
      const res = await apiFetch(`/api/hr/employees/${empId}/position-history`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Failed");
      toast({ title: isAr ? "تم التسجيل" : "Movement recorded" });
      setAdding(false);
      setForm({ changeType: "promotion", effectiveDate: "", fromTitle: "", toTitle: "", fromGrade: "", toGrade: "", notes: "" });
      state.reload();
    } catch { toast({ title: isAr ? "فشل الإضافة" : "Failed", variant: "destructive" }); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-base">{isAr ? "الحركات الوظيفية" : "Job Movements"} ({state.data.length})</h3>
        {isAdmin && <Button size="sm" variant="outline" onClick={() => setAdding(!adding)}><Plus className="w-4 h-4 mr-2" />{isAr ? "إضافة حركة" : "Add Movement"}</Button>}
      </div>

      {adding && (
        <Card className="border-primary/30">
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>{isAr ? "نوع التغيير" : "Change Type"}</Label>
                <Select value={form.changeType} onValueChange={v => setForm(f => ({ ...f, changeType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(CHANGE_TYPES).map(([k,v]) => <SelectItem key={k} value={k}>{isAr ? v.ar : v.en}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>{isAr ? "تاريخ التطبيق" : "Effective Date"} *</Label><Input type="date" value={form.effectiveDate} onChange={e => setForm(f => ({ ...f, effectiveDate: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>{isAr ? "من مسمى" : "From Title"}</Label><Input value={form.fromTitle} onChange={e => setForm(f => ({ ...f, fromTitle: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>{isAr ? "إلى مسمى" : "To Title"}</Label><Input value={form.toTitle} onChange={e => setForm(f => ({ ...f, toTitle: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>{isAr ? "من درجة" : "From Grade"}</Label><Input value={form.fromGrade} onChange={e => setForm(f => ({ ...f, fromGrade: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>{isAr ? "إلى درجة" : "To Grade"}</Label><Input value={form.toGrade} onChange={e => setForm(f => ({ ...f, toGrade: e.target.value }))} /></div>
              <div className="space-y-1.5 sm:col-span-2"><Label>{isAr ? "ملاحظات" : "Notes"}</Label><Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={() => setAdding(false)}>{isAr ? "إلغاء" : "Cancel"}</Button>
              <Button size="sm" onClick={add}>{isAr ? "حفظ" : "Save"}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {state.loading ? <Skeleton className="h-24 w-full" /> :
       state.data.length === 0 ? <EmptyState text={isAr ? "لا توجد حركات وظيفية مسجلة" : "No job movements recorded"} /> :
       <div className="relative border-l-2 border-border ml-3 space-y-0">
         {state.data.map((m: any, i: number) => (
           <div key={m.id} className="flex items-start gap-4 pb-6 relative">
             <div className="absolute -left-[11px] top-0 w-5 h-5 rounded-full bg-primary/10 border-2 border-primary flex items-center justify-center shrink-0">
               <GitBranch className="w-2.5 h-2.5 text-primary" />
             </div>
             <div className="ml-6">
               <div className="flex items-center gap-2 flex-wrap">
                 <span className="font-semibold text-sm">{isAr ? CHANGE_TYPES[m.changeType]?.ar : CHANGE_TYPES[m.changeType]?.en}</span>
                 <span className="text-xs text-muted-foreground">{m.effectiveDate}</span>
               </div>
               {(m.fromTitle || m.toTitle) && (
                 <p className="text-xs text-muted-foreground mt-0.5">
                   {m.fromTitle && <>{isAr ? "من" : "From"}: {m.fromTitle} </>}
                   {m.toTitle && <> → {isAr ? "إلى" : "To"}: {m.toTitle}</>}
                 </p>
               )}
               {(m.fromGrade || m.toGrade) && (
                 <p className="text-xs text-muted-foreground">
                   {isAr ? "الدرجة" : "Grade"}: {m.fromGrade} → {m.toGrade}
                 </p>
               )}
               {m.notes && <p className="text-xs text-muted-foreground mt-0.5 italic">{m.notes}</p>}
             </div>
           </div>
         ))}
       </div>
      }
    </div>
  );
}

function NotesTab({ empId, isAdmin, isAr, state }: { empId: number; isAdmin: boolean; isAr: boolean; state: any }) {
  const { toast } = useToast();
  const apiFetch = useApiFetch();
  const [adding, setAdding] = useState(false);
  const [content, setContent] = useState("");
  const [noteType, setNoteType] = useState("general");

  const NOTE_TYPES: Record<string, { en: string; ar: string; color: string }> = {
    general:       { en: "General",       ar: "عام",          color: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
    performance:   { en: "Performance",   ar: "أداء",         color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" },
    disciplinary:  { en: "Disciplinary",  ar: "تأديبية",      color: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" },
    commendation:  { en: "Commendation",  ar: "إشادة",        color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" },
    confidential:  { en: "Confidential",  ar: "سرية",         color: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" },
  };

  async function add() {
    if (!content.trim()) { toast({ title: isAr ? "المحتوى مطلوب" : "Content required", variant: "destructive" }); return; }
    try {
      const res = await apiFetch(`/api/hr/employees/${empId}/notes`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, noteType }),
      });
      if (!res.ok) throw new Error("Failed");
      toast({ title: isAr ? "تمت إضافة الملاحظة" : "Note added" });
      setAdding(false); setContent(""); setNoteType("general");
      state.reload();
    } catch { toast({ title: isAr ? "فشل الإضافة" : "Failed", variant: "destructive" }); }
  }

  async function del(nid: number) {
    await apiFetch(`/api/hr/employees/${empId}/notes/${nid}`, { method: "DELETE" });
    toast({ title: isAr ? "تم الحذف" : "Deleted" });
    state.reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-base">{isAr ? "الملاحظات" : "Notes"} ({state.data.length})</h3>
        {isAdmin && <Button size="sm" variant="outline" onClick={() => setAdding(!adding)}><Plus className="w-4 h-4 mr-2" />{isAr ? "إضافة ملاحظة" : "Add Note"}</Button>}
      </div>

      {adding && (
        <Card className="border-primary/30">
          <CardContent className="p-4 space-y-3">
            <div className="space-y-1.5">
              <Label>{isAr ? "نوع الملاحظة" : "Note Type"}</Label>
              <div className="flex flex-wrap gap-2">
                {Object.entries(NOTE_TYPES).map(([k,v]) => (
                  <button key={k} type="button"
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${noteType === k ? v.color : "bg-muted text-muted-foreground"}`}
                    onClick={() => setNoteType(k)}>
                    {isAr ? v.ar : v.en}
                  </button>
                ))}
              </div>
            </div>
            <Textarea value={content} onChange={e => setContent(e.target.value)} placeholder={isAr ? "اكتب الملاحظة هنا..." : "Write note here..."} rows={3} />
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={() => setAdding(false)}>{isAr ? "إلغاء" : "Cancel"}</Button>
              <Button size="sm" onClick={add}>{isAr ? "حفظ" : "Save"}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {state.loading ? <Skeleton className="h-24 w-full" /> :
       state.data.length === 0 ? <EmptyState text={isAr ? "لا توجد ملاحظات بعد" : "No notes yet"} /> :
       <div className="space-y-3">
         {state.data.map((n: any) => {
           const nt = NOTE_TYPES[n.noteType];
           return (
             <Card key={n.id}>
               <CardContent className="p-4">
                 <div className="flex items-start justify-between gap-2">
                   <div className="flex-1">
                     <div className="flex items-center gap-2 mb-1">
                       <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${nt?.color ?? "bg-muted text-muted-foreground"}`}>
                         {isAr ? nt?.ar : nt?.en}
                       </span>
                       <span className="text-xs text-muted-foreground">{n.createdByName ?? "System"}</span>
                       <span className="text-xs text-muted-foreground">·</span>
                       <span className="text-xs text-muted-foreground">{new Date(n.createdAt).toLocaleDateString()}</span>
                     </div>
                     <p className="text-sm whitespace-pre-wrap">{n.content}</p>
                   </div>
                   {isAdmin && (
                     <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0" onClick={() => del(n.id)}>
                       <Trash2 className="w-3.5 h-3.5" />
                     </Button>
                   )}
                 </div>
               </CardContent>
             </Card>
           );
         })}
       </div>
      }
    </div>
  );
}

function CustomFieldsTab({ empId, isAdmin, isAr, state }: { empId: number; isAdmin: boolean; isAr: boolean; state: any }) {
  const { toast } = useToast();
  const apiFetch = useApiFetch();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");

  async function saveValue(fieldId: number) {
    try {
      await apiFetch(`/api/hr/employees/${empId}/custom-fields/${fieldId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: editValue }),
      });
      toast({ title: isAr ? "تم الحفظ" : "Saved" });
      setEditingId(null);
      state.reload();
    } catch { toast({ title: isAr ? "فشل الحفظ" : "Failed", variant: "destructive" }); }
  }

  const grouped = (state.data as any[]).reduce((acc: Record<string, any[]>, f: any) => {
    (acc[f.section] ??= []).push(f);
    return acc;
  }, {} as Record<string, any[]>);

  const SECTION_LABELS: Record<string, { en: string; ar: string }> = {
    personal:   { en: "Personal",    ar: "شخصية" },
    employment: { en: "Employment",  ar: "وظيفية" },
    org:        { en: "Org",         ar: "تنظيمية" },
    emergency:  { en: "Emergency",   ar: "طوارئ" },
    custom:     { en: "Custom",      ar: "مخصصة" },
  };

  if (state.loading) return <Skeleton className="h-24 w-full" />;
  if (state.data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Settings className="w-12 h-12 text-muted-foreground/30 mb-3" />
        <p className="font-medium text-muted-foreground">{isAr ? "لا توجد حقول مخصصة" : "No custom fields defined"}</p>
        <p className="text-sm text-muted-foreground mt-1">
          {isAr ? "يمكن للمسؤول إضافة حقول مخصصة من إعدادات الموارد البشرية" : "Admins can add custom fields from HR Settings"}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {(Object.entries(grouped) as [string, any[]][]).map(([section, fields]) => (
        <Card key={section}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              {isAr ? SECTION_LABELS[section]?.ar : SECTION_LABELS[section]?.en} {isAr ? "- حقول" : "- Fields"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {fields.map((f: any) => (
                <div key={f.id}>
                  <Label className="text-xs text-muted-foreground">
                    {isAr && f.labelAr ? f.labelAr : f.label}
                    {f.required && <span className="text-destructive ml-0.5">*</span>}
                  </Label>
                  {editingId === f.id ? (
                    <div className="flex gap-2 mt-1">
                      <Input
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        className="text-sm"
                        autoFocus
                      />
                      <Button size="sm" onClick={() => saveValue(f.id)}>{isAr ? "حفظ" : "Save"}</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}><X className="w-4 h-4" /></Button>
                    </div>
                  ) : (
                    <div
                      className={`mt-1 text-sm ${isAdmin ? "cursor-pointer hover:text-primary" : ""} ${f.value === null || f.value === undefined ? "text-muted-foreground italic" : ""}`}
                      onClick={() => {
                        if (!isAdmin) return;
                        setEditingId(f.id);
                        setEditValue(typeof f.value === "string" ? f.value : f.value !== null ? String(f.value) : "");
                      }}
                    >
                      {f.value !== null && f.value !== undefined ? String(f.value) : (isAr ? "- لم يُعبأ -" : "- Not filled -")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ActivityTab({ isAr, state }: { isAr: boolean; state: any }) {
  const ACTION_ICONS: Record<string, React.ReactNode> = {
    employee_created:    <UserPlus className="w-3.5 h-3.5 text-emerald-500" />,
    profile_updated:     <Pencil className="w-3.5 h-3.5 text-blue-500" />,
    contract_added:      <FileText className="w-3.5 h-3.5 text-violet-500" />,
    document_added:      <FileBadge className="w-3.5 h-3.5 text-amber-500" />,
    leave_added:         <Plane className="w-3.5 h-3.5 text-sky-500" />,
    position_change:     <GitBranch className="w-3.5 h-3.5 text-rose-500" />,
    custom_field_updated:<Settings className="w-3.5 h-3.5 text-zinc-500" />,
  };

  if (state.loading) return <Skeleton className="h-40 w-full" />;
  if (state.data.length === 0) return <EmptyState text={isAr ? "لا يوجد نشاط مسجل" : "No activity recorded yet"} />;

  return (
    <div className="space-y-2">
      {state.data.map((a: any) => (
        <div key={a.id} className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors">
          <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
            {ACTION_ICONS[a.action] ?? <Activity className="w-3.5 h-3.5 text-muted-foreground" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">{a.description ?? a.action}</p>
            <div className="flex items-center gap-2 mt-0.5">
              {a.performedByName && <span className="text-xs text-muted-foreground">{a.performedByName}</span>}
              <span className="text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function UserPlus(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="16" y1="11" x2="22" y2="11" />
    </svg>
  );
}
