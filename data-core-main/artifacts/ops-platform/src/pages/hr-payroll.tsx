import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  DollarSign, Plus, Play, CheckCircle2, Wallet, BarChart3,
  Layers, Sliders, TrendingUp, ChevronRight, RefreshCw,
  Trash2, Pencil, AlertCircle, Ban,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTH_NAMES_AR = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

function fmtCurrency(val: string | number | null, currency = "SAR") {
  const n = parseFloat(String(val ?? 0)) || 0;
  return `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

const RUN_STATUS_CONFIG: Record<string, { label: string; labelAr: string; color: string }> = {
  draft:      { label: "Draft",      labelAr: "مسودة",    color: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
  processing: { label: "Processing", labelAr: "جاري",     color: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
  approved:   { label: "Approved",   labelAr: "معتمد",    color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  paid:       { label: "Paid",       labelAr: "مدفوع",    color: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300" },
  cancelled:  { label: "Cancelled",  labelAr: "ملغى",     color: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
};

const COMP_TYPE_CONFIG: Record<string, { label: string; labelAr: string; color: string }> = {
  base:       { label: "Base",       labelAr: "أساسي",    color: "bg-blue-100 text-blue-700" },
  allowance:  { label: "Allowance",  labelAr: "بدل",      color: "bg-emerald-100 text-emerald-700" },
  deduction:  { label: "Deduction",  labelAr: "خصم",      color: "bg-red-100 text-red-700" },
  bonus:      { label: "Bonus",      labelAr: "مكافأة",   color: "bg-amber-100 text-amber-700" },
  overtime:   { label: "Overtime",   labelAr: "إضافي",    color: "bg-violet-100 text-violet-700" },
};

export default function HrPayrollPage() {
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const { toast } = useToast();
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = useState("runs");
  const [newRunOpen, setNewRunOpen] = useState(false);
  const [newComponentOpen, setNewComponentOpen] = useState(false);
  const [newStructureOpen, setNewStructureOpen] = useState(false);
  const [newBandOpen, setNewBandOpen] = useState(false);
  const [editingComponent, setEditingComponent] = useState<Record<string, unknown> | null>(null);
  const [editingBand, setEditingBand] = useState<Record<string, unknown> | null>(null);

  const [runForm, setRunForm] = useState({ periodYear: String(new Date().getFullYear()), periodMonth: String(new Date().getMonth() + 1), currencyCode: "SAR", notes: "" });
  const [compForm, setCompForm] = useState({ name: "", nameAr: "", componentType: "allowance", calculationType: "fixed", defaultValue: "", isTaxable: false });
  const [structForm, setStructForm] = useState({ name: "", nameAr: "", description: "", currencyCode: "SAR", isDefault: false });
  const [bandForm, setBandForm] = useState({ name: "", nameAr: "", gradeId: "__none__", currencyCode: "SAR", minAmount: "", midpointAmount: "", maxAmount: "" });

  const runsQ    = useQuery({ queryKey: ["/hr/payroll/runs"],       queryFn: () => apiClient.get("/api/hr/payroll/runs").then((r) => r.data) });
  const compsQ   = useQuery({ queryKey: ["/hr/payroll/components"], queryFn: () => apiClient.get("/api/hr/payroll/components").then((r) => r.data) });
  const structsQ = useQuery({ queryKey: ["/hr/payroll/structures"], queryFn: () => apiClient.get("/api/hr/payroll/structures").then((r) => r.data) });
  const bandsQ   = useQuery({ queryKey: ["/hr/payroll/bands"],      queryFn: () => apiClient.get("/api/hr/payroll/bands").then((r) => r.data) });
  const gradesQ  = useQuery({ queryKey: ["/hr/job-grades"], queryFn: () => apiClient.get("/api/hr/job-grades").then((r) => r.data) });

  const createRun = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post("/api/hr/payroll/runs", body).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/hr/payroll/runs"] }); setNewRunOpen(false); toast({ title: isAr ? "تم إنشاء المسيرة" : "Payroll run created" }); },
    onError: () => toast({ title: isAr ? "حدث خطأ" : "Error", variant: "destructive" }),
  });

  const processRun = useMutation({
    mutationFn: (id: number) => apiClient.post(`/api/hr/payroll/runs/${id}/process`, {}).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/hr/payroll/runs"] }); toast({ title: isAr ? "تمت معالجة المسيرة بنجاح" : "Payroll processed successfully" }); },
    onError: () => toast({ title: isAr ? "حدث خطأ في المعالجة" : "Processing failed", variant: "destructive" }),
  });

  const updateRunStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => apiClient.patch(`/api/hr/payroll/runs/${id}`, { status }).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/hr/payroll/runs"] }); toast({ title: isAr ? "تم تحديث الحالة" : "Status updated" }); },
  });

  const createComp = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post("/api/hr/payroll/components", body).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/hr/payroll/components"] }); setNewComponentOpen(false); setEditingComponent(null); toast({ title: isAr ? "تم الحفظ" : "Saved" }); },
  });

  const updateComp = useMutation({
    mutationFn: ({ id, ...body }: Record<string, unknown>) => apiClient.patch(`/api/hr/payroll/components/${id}`, body).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/hr/payroll/components"] }); setEditingComponent(null); toast({ title: isAr ? "تم التحديث" : "Updated" }); },
  });

  const deleteComp = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/api/hr/payroll/components/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/hr/payroll/components"] }); toast({ title: isAr ? "تم الحذف" : "Deleted" }); },
  });

  const createStruct = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post("/api/hr/payroll/structures", body).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/hr/payroll/structures"] }); setNewStructureOpen(false); toast({ title: isAr ? "تم الحفظ" : "Saved" }); },
  });

  const createBand = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post("/api/hr/payroll/bands", body).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/hr/payroll/bands"] }); setNewBandOpen(false); setEditingBand(null); toast({ title: isAr ? "تم الحفظ" : "Saved" }); },
  });

  const updateBand = useMutation({
    mutationFn: ({ id, ...body }: Record<string, unknown>) => apiClient.patch(`/api/hr/payroll/bands/${id}`, body).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/hr/payroll/bands"] }); setEditingBand(null); toast({ title: isAr ? "تم التحديث" : "Updated" }); },
  });

  const deleteBand = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/api/hr/payroll/bands/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/hr/payroll/bands"] }); },
  });

  const runs    = (runsQ.data    ?? []) as Record<string, unknown>[];
  const comps   = (compsQ.data   ?? []) as Record<string, unknown>[];
  const structs = (structsQ.data ?? []) as Record<string, unknown>[];
  const bands   = (bandsQ.data   ?? []) as Record<string, unknown>[];
  const grades  = (gradesQ.data  ?? []) as Record<string, unknown>[];

  const totalNetPaid = runs.filter((r) => r.status === "paid").reduce((s, r) => s + (parseFloat(String(r.totalNet)) || 0), 0);
  const pendingRuns  = runs.filter((r) => ["draft", "processing"].includes(String(r.status)));

  const compFormData = editingComponent ?? compForm;
  const bandFormData = editingBand ?? bandForm;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" dir={isAr ? "rtl" : "ltr"}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{isAr ? "محرك الرواتب والتعويضات" : "Payroll & Compensation"}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{isAr ? "إدارة الرواتب والمسيرات والهياكل الوظيفية" : "Manage payroll runs, structures, and compensation"}</p>
        </div>
        <Link href={`${BASE}/hr`}>
          <Button variant="outline" size="sm">{isAr ? "لوحة HR" : "HR Hub"}</Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: Wallet,    label: isAr ? "مسيرات مدفوعة" : "Paid Runs",    value: runs.filter((r) => r.status === "paid").length,    color: "bg-violet-50 text-violet-600 dark:bg-violet-950" },
          { icon: RefreshCw, label: isAr ? "مسيرات معلقة" : "Pending Runs",  value: pendingRuns.length,                                color: "bg-amber-50 text-amber-600 dark:bg-amber-950" },
          { icon: Layers,    label: isAr ? "هياكل الراتب" : "Structures",     value: structs.length,                                    color: "bg-blue-50 text-blue-600 dark:bg-blue-950" },
          { icon: Sliders,   label: isAr ? "مكونات الراتب" : "Components",    value: comps.length,                                      color: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950" },
        ].map(({ icon: Icon, label, value, color }) => (
          <Card key={label} className="hover:shadow-md transition-shadow">
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
                <Icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-xl font-bold">{value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="runs">{isAr ? "المسيرات" : "Payroll Runs"}</TabsTrigger>
          <TabsTrigger value="structures">{isAr ? "هياكل الراتب" : "Structures"}</TabsTrigger>
          <TabsTrigger value="components">{isAr ? "المكونات" : "Components"}</TabsTrigger>
          <TabsTrigger value="bands">{isAr ? "النطاقات" : "Salary Bands"}</TabsTrigger>
        </TabsList>

        {/* ── RUNS ───────────────────────────────────────────────── */}
        <TabsContent value="runs" className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">{isAr ? `${runs.length} مسيرة` : `${runs.length} runs`}</p>
            <Button onClick={() => setNewRunOpen(true)} size="sm"><Plus className="w-4 h-4 me-1" />{isAr ? "مسيرة جديدة" : "New Run"}</Button>
          </div>
          {runsQ.isLoading ? (
            <div className="space-y-2">{[1,2,3].map((i) => <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />)}</div>
          ) : runs.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground"><DollarSign className="w-10 h-10 mx-auto mb-2 opacity-30" /><p>{isAr ? "لا توجد مسيرات بعد" : "No payroll runs yet"}</p></CardContent></Card>
          ) : (
            <div className="space-y-2">
              {runs.map((run) => {
                const statusCfg = RUN_STATUS_CONFIG[String(run.status)] ?? RUN_STATUS_CONFIG.draft;
                const monthIdx = Number(run.periodMonth) - 1;
                const monthName = isAr ? MONTH_NAMES_AR[monthIdx] : MONTH_NAMES[monthIdx];
                return (
                  <Card key={String(run.id)} className="hover:shadow-sm transition-shadow">
                    <CardContent className="p-4 flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center bg-primary/10`}>
                        <BarChart3 className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold">{monthName} {String(run.periodYear)}</span>
                          <Badge className={`text-xs ${statusCfg.color}`}>{isAr ? statusCfg.labelAr : statusCfg.label}</Badge>
                          {run.employeeCount ? <span className="text-xs text-muted-foreground">{String(run.employeeCount)} {isAr ? "موظف" : "employees"}</span> : null}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 flex-wrap text-xs text-muted-foreground">
                          <span>{isAr ? "الإجمالي:" : "Net:"} <span className="font-medium text-foreground">{fmtCurrency(String(run.totalNet), String(run.currencyCode))}</span></span>
                          {Boolean(run.totalGross) && String(run.totalGross) !== "0" && <span>{isAr ? "الخام:" : "Gross:"} {fmtCurrency(String(run.totalGross), String(run.currencyCode))}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {run.status === "draft" && (
                          <Button size="sm" variant="outline" onClick={() => processRun.mutate(Number(run.id))} disabled={processRun.isPending}>
                            <Play className="w-3.5 h-3.5 me-1" />{isAr ? "معالجة" : "Process"}
                          </Button>
                        )}
                        {run.status === "approved" && (
                          <Button size="sm" variant="outline" onClick={() => updateRunStatus.mutate({ id: Number(run.id), status: "paid" })}>
                            <CheckCircle2 className="w-3.5 h-3.5 me-1" />{isAr ? "تأكيد الدفع" : "Mark Paid"}
                          </Button>
                        )}
                        <Link href={`${BASE}/admin/hr/payroll/runs/${run.id}`}>
                          <Button size="sm" variant="ghost"><ChevronRight className="w-4 h-4" /></Button>
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── STRUCTURES ─────────────────────────────────────────── */}
        <TabsContent value="structures" className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">{isAr ? `${structs.length} هيكل` : `${structs.length} structures`}</p>
            <Button onClick={() => setNewStructureOpen(true)} size="sm"><Plus className="w-4 h-4 me-1" />{isAr ? "هيكل جديد" : "New Structure"}</Button>
          </div>
          {structsQ.isLoading ? (
            <div className="space-y-2">{[1,2].map((i) => <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />)}</div>
          ) : structs.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground"><Layers className="w-10 h-10 mx-auto mb-2 opacity-30" /><p>{isAr ? "لا توجد هياكل بعد" : "No salary structures yet"}</p></CardContent></Card>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {structs.map((s) => (
                <Card key={String(s.id)} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{String(s.name)}</span>
                          {Boolean(s.isDefault) && <Badge className="text-xs bg-primary/10 text-primary">{isAr ? "افتراضي" : "Default"}</Badge>}
                        </div>
                        {Boolean(s.nameAr) && <p className="text-sm text-muted-foreground mt-0.5">{String(s.nameAr)}</p>}
                        {Boolean(s.description) && <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{String(s.description)}</p>}
                        <p className="text-xs text-muted-foreground mt-1">{String(s.currencyCode)}</p>
                      </div>
                      <Link href={`${BASE}/admin/hr/payroll/structures/${s.id}`}>
                        <Button size="sm" variant="outline"><ChevronRight className="w-4 h-4" /></Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── COMPONENTS ─────────────────────────────────────────── */}
        <TabsContent value="components" className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">{isAr ? `${comps.length} مكون` : `${comps.length} components`}</p>
            <Button onClick={() => { setCompForm({ name: "", nameAr: "", componentType: "allowance", calculationType: "fixed", defaultValue: "", isTaxable: false }); setNewComponentOpen(true); }} size="sm">
              <Plus className="w-4 h-4 me-1" />{isAr ? "مكون جديد" : "New Component"}
            </Button>
          </div>
          {compsQ.isLoading ? (
            <div className="space-y-2">{[1,2,3].map((i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />)}</div>
          ) : comps.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground"><Sliders className="w-10 h-10 mx-auto mb-2 opacity-30" /><p>{isAr ? "لا توجد مكونات بعد" : "No components yet"}</p></CardContent></Card>
          ) : (
            <div className="space-y-2">
              {comps.map((c) => {
                const typeCfg = COMP_TYPE_CONFIG[String(c.componentType)] ?? COMP_TYPE_CONFIG.allowance;
                return (
                  <div key={String(c.id)} className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:shadow-sm transition-shadow">
                    <Badge className={`text-xs shrink-0 ${typeCfg.color}`}>{isAr ? typeCfg.labelAr : typeCfg.label}</Badge>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{String(c.name)}</p>
                      <p className="text-xs text-muted-foreground">
                        {String(c.calculationType) === "fixed" ? (isAr ? "مبلغ ثابت" : "Fixed amount") : isAr ? "نسبة مئوية" : "Percentage"}
                        {c.defaultValue ? ` · ${String(c.defaultValue)}` : ""}
                        {c.isTaxable ? ` · ${isAr ? "خاضع للضريبة" : "Taxable"}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditingComponent({ ...c }); setNewComponentOpen(true); }}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteComp.mutate(Number(c.id))}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── BANDS ──────────────────────────────────────────────── */}
        <TabsContent value="bands" className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">{isAr ? `${bands.length} نطاق` : `${bands.length} bands`}</p>
            <Button onClick={() => { setBandForm({ name: "", nameAr: "", gradeId: "__none__", currencyCode: "SAR", minAmount: "", midpointAmount: "", maxAmount: "" }); setNewBandOpen(true); }} size="sm">
              <Plus className="w-4 h-4 me-1" />{isAr ? "نطاق جديد" : "New Band"}
            </Button>
          </div>
          {bandsQ.isLoading ? (
            <div className="space-y-2">{[1,2].map((i) => <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />)}</div>
          ) : bands.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground"><TrendingUp className="w-10 h-10 mx-auto mb-2 opacity-30" /><p>{isAr ? "لا توجد نطاقات بعد" : "No salary bands yet"}</p></CardContent></Card>
          ) : (
            <div className="space-y-2">
              {bands.map((b) => (
                <Card key={String(b.id)} className="hover:shadow-sm transition-shadow">
                  <CardContent className="p-4 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{String(b.name)}</span>
                        {Boolean(b.gradeName) && <Badge variant="outline" className="text-xs">{String(b.gradeName)}</Badge>}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                        <span>{isAr ? "الأدنى:" : "Min:"} <span className="font-medium text-foreground">{fmtCurrency(String(b.minAmount), String(b.currencyCode))}</span></span>
                        {Boolean(b.midpointAmount) && <span>{isAr ? "المنتصف:" : "Mid:"} <span className="font-medium text-foreground">{fmtCurrency(String(b.midpointAmount), String(b.currencyCode))}</span></span>}
                        <span>{isAr ? "الأقصى:" : "Max:"} <span className="font-medium text-foreground">{fmtCurrency(String(b.maxAmount), String(b.currencyCode))}</span></span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditingBand({ ...b, gradeId: b.gradeId ? String(b.gradeId) : "__none__" }); setNewBandOpen(true); }}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteBand.mutate(Number(b.id))}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ── New Run Dialog ───────────────────────────────────────── */}
      <Dialog open={newRunOpen} onOpenChange={setNewRunOpen}>
        <DialogContent dir={isAr ? "rtl" : "ltr"}>
          <DialogHeader><DialogTitle>{isAr ? "مسيرة رواتب جديدة" : "New Payroll Run"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{isAr ? "السنة" : "Year"}</Label>
                <Input type="number" value={runForm.periodYear} onChange={(e) => setRunForm((f) => ({ ...f, periodYear: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>{isAr ? "الشهر" : "Month"}</Label>
                <Select value={runForm.periodMonth} onValueChange={(v) => setRunForm((f) => ({ ...f, periodMonth: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MONTH_NAMES.map((m, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)}>{isAr ? MONTH_NAMES_AR[i] : m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{isAr ? "العملة" : "Currency"}</Label>
              <Input value={runForm.currencyCode} onChange={(e) => setRunForm((f) => ({ ...f, currencyCode: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewRunOpen(false)}>{isAr ? "إلغاء" : "Cancel"}</Button>
            <Button onClick={() => createRun.mutate({ ...runForm, periodYear: Number(runForm.periodYear), periodMonth: Number(runForm.periodMonth) })} disabled={createRun.isPending}>
              {isAr ? "إنشاء" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Component Dialog ─────────────────────────────────────── */}
      <Dialog open={newComponentOpen} onOpenChange={(o) => { setNewComponentOpen(o); if (!o) setEditingComponent(null); }}>
        <DialogContent dir={isAr ? "rtl" : "ltr"}>
          <DialogHeader><DialogTitle>{editingComponent ? (isAr ? "تعديل المكون" : "Edit Component") : (isAr ? "مكون راتب جديد" : "New Salary Component")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{isAr ? "الاسم بالإنجليزية" : "Name (English)"}</Label>
              <Input value={String(compFormData.name ?? "")} onChange={(e) => editingComponent ? setEditingComponent((f) => ({ ...f!, name: e.target.value })) : setCompForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>{isAr ? "الاسم بالعربية" : "Name (Arabic)"}</Label>
              <Input dir="rtl" value={String(compFormData.nameAr ?? "")} onChange={(e) => editingComponent ? setEditingComponent((f) => ({ ...f!, nameAr: e.target.value })) : setCompForm((f) => ({ ...f, nameAr: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{isAr ? "النوع" : "Type"}</Label>
                <Select value={String(compFormData.componentType ?? "allowance")} onValueChange={(v) => editingComponent ? setEditingComponent((f) => ({ ...f!, componentType: v })) : setCompForm((f) => ({ ...f, componentType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(COMP_TYPE_CONFIG).filter(([k]) => k !== "base").map(([k, v]) => (
                      <SelectItem key={k} value={k}>{isAr ? v.labelAr : v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{isAr ? "طريقة الحساب" : "Calculation"}</Label>
                <Select value={String(compFormData.calculationType ?? "fixed")} onValueChange={(v) => editingComponent ? setEditingComponent((f) => ({ ...f!, calculationType: v })) : setCompForm((f) => ({ ...f, calculationType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">{isAr ? "مبلغ ثابت" : "Fixed amount"}</SelectItem>
                    <SelectItem value="percentage_of_basic">{isAr ? "% من الأساسي" : "% of basic"}</SelectItem>
                    <SelectItem value="percentage_of_gross">{isAr ? "% من الإجمالي" : "% of gross"}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{isAr ? "القيمة الافتراضية" : "Default Value"}</Label>
              <Input type="number" value={String(compFormData.defaultValue ?? "")} onChange={(e) => editingComponent ? setEditingComponent((f) => ({ ...f!, defaultValue: e.target.value })) : setCompForm((f) => ({ ...f, defaultValue: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setNewComponentOpen(false); setEditingComponent(null); }}>{isAr ? "إلغاء" : "Cancel"}</Button>
            <Button onClick={() => {
              if (editingComponent) {
                updateComp.mutate({ ...editingComponent });
              } else {
                createComp.mutate({ ...compForm });
              }
            }} disabled={createComp.isPending || updateComp.isPending}>
              {isAr ? "حفظ" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Structure Dialog ─────────────────────────────────────── */}
      <Dialog open={newStructureOpen} onOpenChange={setNewStructureOpen}>
        <DialogContent dir={isAr ? "rtl" : "ltr"}>
          <DialogHeader><DialogTitle>{isAr ? "هيكل راتب جديد" : "New Salary Structure"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{isAr ? "الاسم بالإنجليزية" : "Name (English)"}</Label>
              <Input value={structForm.name} onChange={(e) => setStructForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>{isAr ? "الاسم بالعربية" : "Name (Arabic)"}</Label>
              <Input dir="rtl" value={structForm.nameAr} onChange={(e) => setStructForm((f) => ({ ...f, nameAr: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>{isAr ? "الوصف" : "Description"}</Label>
              <Input value={structForm.description} onChange={(e) => setStructForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>{isAr ? "العملة" : "Currency"}</Label>
              <Input value={structForm.currencyCode} onChange={(e) => setStructForm((f) => ({ ...f, currencyCode: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewStructureOpen(false)}>{isAr ? "إلغاء" : "Cancel"}</Button>
            <Button onClick={() => createStruct.mutate({ ...structForm })} disabled={createStruct.isPending}>{isAr ? "إنشاء" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Band Dialog ───────────────────────────────────────────── */}
      <Dialog open={newBandOpen} onOpenChange={(o) => { setNewBandOpen(o); if (!o) setEditingBand(null); }}>
        <DialogContent dir={isAr ? "rtl" : "ltr"}>
          <DialogHeader><DialogTitle>{editingBand ? (isAr ? "تعديل النطاق" : "Edit Band") : (isAr ? "نطاق راتب جديد" : "New Salary Band")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{isAr ? "الاسم" : "Name"}</Label>
              <Input value={String(bandFormData.name ?? "")} onChange={(e) => editingBand ? setEditingBand((f) => ({ ...f!, name: e.target.value })) : setBandForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>{isAr ? "الدرجة الوظيفية" : "Job Grade"}</Label>
              <Select value={String(bandFormData.gradeId ?? "__none__")} onValueChange={(v) => editingBand ? setEditingBand((f) => ({ ...f!, gradeId: v })) : setBandForm((f) => ({ ...f, gradeId: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{isAr ? "- بدون درجة -" : "- No grade -"}</SelectItem>
                  {grades.map((g) => <SelectItem key={String(g.id)} value={String(g.id)}>{String(g.name)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1.5">
                <Label>{isAr ? "الحد الأدنى" : "Min"}</Label>
                <Input type="number" value={String(bandFormData.minAmount ?? "")} onChange={(e) => editingBand ? setEditingBand((f) => ({ ...f!, minAmount: e.target.value })) : setBandForm((f) => ({ ...f, minAmount: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>{isAr ? "المنتصف" : "Midpoint"}</Label>
                <Input type="number" value={String(bandFormData.midpointAmount ?? "")} onChange={(e) => editingBand ? setEditingBand((f) => ({ ...f!, midpointAmount: e.target.value })) : setBandForm((f) => ({ ...f, midpointAmount: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>{isAr ? "الحد الأقصى" : "Max"}</Label>
                <Input type="number" value={String(bandFormData.maxAmount ?? "")} onChange={(e) => editingBand ? setEditingBand((f) => ({ ...f!, maxAmount: e.target.value })) : setBandForm((f) => ({ ...f, maxAmount: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setNewBandOpen(false); setEditingBand(null); }}>{isAr ? "إلغاء" : "Cancel"}</Button>
            <Button onClick={() => {
              const data = editingBand ?? bandForm;
              const gradeId = String(data.gradeId) === "__none__" ? null : Number(data.gradeId);
              if (editingBand) {
                updateBand.mutate({ ...editingBand, gradeId });
              } else {
                createBand.mutate({ ...data, gradeId });
              }
            }} disabled={createBand.isPending || updateBand.isPending}>
              {isAr ? "حفظ" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
